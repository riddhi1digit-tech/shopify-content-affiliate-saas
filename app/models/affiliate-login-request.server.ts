import { createHash } from "node:crypto";
import db from "../db.server";
import { createAffiliateInvite } from "./affiliate-access.server";
import { emailConfiguration, sendAffiliateLoginEmail } from "./affiliate-email.server";

export const requestMessage = "If you are an active affiliate for this store, a sign-in link will be emailed. Check your inbox/spam folder. Repeated requests may be limited; try again in 15 minutes or contact your merchant.";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function consumeLoginRequestLimit(shop: string, email: string) {
  const now = BigInt(Date.now());
  const cutoff = now - 900000n;
  return db.$transaction(async (tx) => {
    // Global + store caps prevent distributing requests over arbitrary emails.
    const buckets = [{ id: "global", limit: 100 }, { id: `store:${hash(shop)}`, limit: 30 }, { id: `email:${hash(`${shop}:${email}`)}`, limit: 3 }];
    let allowed = true;
    for (const bucket of buckets) {
      await tx.$executeRaw`INSERT INTO "AffiliateLoginLimit" ("id", "windowStart", "count") VALUES (${bucket.id}, ${now}, 1) ON CONFLICT("id") DO UPDATE SET "count" = CASE WHEN "windowStart" <= ${cutoff} THEN 1 ELSE "count" + 1 END, "windowStart" = CASE WHEN "windowStart" <= ${cutoff} THEN ${now} ELSE "windowStart" END`;
      const rows = await tx.$queryRaw<Array<{ count: number }>>`SELECT "count" FROM "AffiliateLoginLimit" WHERE "id" = ${bucket.id}`;
      if (rows[0].count > bucket.limit) allowed = false;
    }
    await tx.$executeRaw`DELETE FROM "AffiliateLoginLimit" WHERE "windowStart" < ${cutoff - 900000n}`;
    return allowed;
  });
}

export async function requestAffiliateLogin(shopValue: string, emailValue: string, appOrigin: string) {
  const shop = shopValue.trim().toLowerCase();
  const email = emailValue.trim().toLowerCase();
  // All account, eligibility, throttling and provider outcomes use one response.
  try {
    if (shop.length > 100 || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return requestMessage;
    if (!(await consumeLoginRequestLimit(shop, email))) return requestMessage;
    const store = await db.store.findFirst({ where: { shopDomain: shop, status: "ACTIVE" } });
    if (!store) return requestMessage;
    const affiliate = await db.affiliate.findFirst({ where: { organizationId: store.organizationId, email, status: { in: ["ACTIVE", "APPROVED"] } } });
    if (!affiliate) return requestMessage;
    emailConfiguration();
    // A public email request must not log someone out or invalidate old invites.
    const token = await createAffiliateInvite({ affiliateId: affiliate.id, organizationId: store.organizationId, storeId: store.id }, false);
    await sendAffiliateLoginEmail({ email: affiliate.email, name: affiliate.name, storeName: store.name ?? shop, loginUrl: `${appOrigin}/affiliate-login#token=${token}` });
  } catch {
    console.warn("Affiliate self-service sign-in could not be completed; check database/configuration and Resend delivery logs.");
  }
  return requestMessage;
}
