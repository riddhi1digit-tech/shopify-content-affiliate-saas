import { createHash, randomBytes } from "node:crypto";
import { createCookie, redirect } from "react-router";
import db from "../db.server";

const cookie = createCookie("cah_affiliate_session", {
  httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 86400,
});
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Access = { affiliateId: string; organizationId: string; storeId: string };

export function privateHeaders() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
}

export function checkOrigin(request: Request) {
  // Reverse proxies may expose an internal localhost URL to the app. Trust the
  // server-configured public URL, never arbitrary forwarded/Host headers.
  const publicUrl = process.env.SHOPIFY_APP_URL;
  const expectedOrigin = new URL(publicUrl || request.url).origin;
  if (request.headers.get("Origin") !== expectedOrigin) {
    throw new Response("Invalid request origin", { status: 403 });
  }
}

export async function createAffiliateInvite(access: Access, revokeExisting = true) {
  const token = randomBytes(32).toString("hex");
  await db.$transaction(async (tx) => {
    // Issuing another invite revokes previous invites and sessions.
    if (revokeExisting) await tx.$executeRaw`DELETE FROM "AffiliateAccess" WHERE "affiliateId" = ${access.affiliateId} AND "organizationId" = ${access.organizationId}`;
    await tx.$executeRaw`INSERT INTO "AffiliateAccess" ("digest", "affiliateId", "organizationId", "storeId", "kind", "expiresAt") VALUES (${digest(token)}, ${access.affiliateId}, ${access.organizationId}, ${access.storeId}, 'INVITE', ${BigInt(Date.now() + 1800000)})`;
  });
  return token;
}

export async function redeemAffiliateInvite(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid or expired sign-in link.");
  const sessionToken = randomBytes(32).toString("hex");
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Access[]>`SELECT "affiliateId", "organizationId", "storeId" FROM "AffiliateAccess" WHERE "digest" = ${digest(token)} AND "kind" = 'INVITE' AND "expiresAt" > ${BigInt(Date.now())}`;
    const access = rows[0];
    if (!access) throw new Error("Link expired or already used. Ask the merchant for a new link.");
    const affiliate = await tx.affiliate.findFirst({ where: { id: access.affiliateId, organizationId: access.organizationId, status: { in: ["ACTIVE", "APPROVED"] } } });
    if (!affiliate) throw new Error("Affiliate access is not active.");
    const removed = await tx.$executeRaw`DELETE FROM "AffiliateAccess" WHERE "digest" = ${digest(token)} AND "kind" = 'INVITE'`;
    if (removed !== 1) throw new Error("Link already used.");
    await tx.$executeRaw`INSERT INTO "AffiliateAccess" ("digest", "affiliateId", "organizationId", "storeId", "kind", "expiresAt") VALUES (${digest(sessionToken)}, ${access.affiliateId}, ${access.organizationId}, ${access.storeId}, 'SESSION', ${BigInt(Date.now() + 86400000)})`;
  });
  return cookie.serialize(sessionToken);
}

export async function requireAffiliate(request: Request) {
  const token = await cookie.parse(request.headers.get("Cookie"));
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw redirect("/affiliate-login");
  const rows = await db.$queryRaw<Access[]>`SELECT "affiliateId", "organizationId", "storeId" FROM "AffiliateAccess" WHERE "digest" = ${digest(token)} AND "kind" = 'SESSION' AND "expiresAt" > ${BigInt(Date.now())}`;
  const access = rows[0];
  if (!access) throw redirect("/affiliate-login");
  const affiliate = await db.affiliate.findFirst({ where: { id: access.affiliateId, organizationId: access.organizationId, status: { in: ["ACTIVE", "APPROVED"] } } });
  const store = await db.store.findFirst({ where: { id: access.storeId, organizationId: access.organizationId, status: "ACTIVE" } });
  if (!affiliate || !store) throw redirect("/affiliate-login");
  return { affiliate, store };
}

export async function logoutAffiliate(request: Request) {
  const token = await cookie.parse(request.headers.get("Cookie"));
  if (typeof token === "string") await db.$executeRaw`DELETE FROM "AffiliateAccess" WHERE "digest" = ${digest(token)} AND "kind" = 'SESSION'`;
  return cookie.serialize("", { maxAge: 0 });
}
