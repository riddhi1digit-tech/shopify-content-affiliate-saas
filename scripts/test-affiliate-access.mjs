import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createCookie, redirect } from "react-router";

// Isolated in-memory database; no merchant credentials or data are touched.
const sql = new DatabaseSync(":memory:");
sql.exec('CREATE TABLE AffiliateAccess (digest TEXT PRIMARY KEY, affiliateId TEXT, organizationId TEXT, storeId TEXT, kind TEXT, expiresAt BIGINT)');
let active = true;
const run = (parts, values, query) => {
  const statement = sql.prepare(parts.join("?"));
  return query ? statement.all(...values) : Number(statement.run(...values).changes);
};
const client = {
  $executeRaw: (parts, ...values) => run(parts, values, false),
  $queryRaw: (parts, ...values) => run(parts, values, true),
  affiliate: { findFirst: async ({ where }) => active && where.id === "affiliate" && where.organizationId === "org" ? { id: "affiliate", organizationId: "org" } : null },
  store: { findFirst: async ({ where }) => where.id === "store" && where.organizationId === "org" ? { id: "store" } : null },
};
client.$transaction = async (callback) => {
  sql.exec("BEGIN");
  try { const result = await callback(client); sql.exec("COMMIT"); return result; }
  catch (error) { sql.exec("ROLLBACK"); throw error; }
};
globalThis.__affiliateAccessTest = { db: client, createCookie, redirect };
const source = await readFile(new URL("../app/models/affiliate-access.server.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source.replace('import db from "../db.server";', "const db = globalThis.__affiliateAccessTest.db;").replace('import { createCookie, redirect } from "react-router";', "const { createCookie, redirect } = globalThis.__affiliateAccessTest;"));
const auth = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const access = { affiliateId: "affiliate", organizationId: "org", storeId: "store" };
await assert.rejects(auth.redeemAffiliateInvite("invalid"));
const token = await auth.createAffiliateInvite(access);
assert.notEqual(sql.prepare("SELECT digest FROM AffiliateAccess").get().digest, token);
const cookie = await auth.redeemAffiliateInvite(token);
await assert.rejects(auth.redeemAffiliateInvite(token));
const request = new Request("https://test.example/affiliate-portal", { headers: { Cookie: cookie.split(";")[0] } });
assert.equal((await auth.requireAffiliate(request)).affiliate.id, "affiliate");
active = false;
await assert.rejects(auth.requireAffiliate(request));
active = true;
await auth.logoutAffiliate(request);
await assert.rejects(auth.requireAffiliate(request));
const expired = await auth.createAffiliateInvite(access);
sql.exec("UPDATE AffiliateAccess SET expiresAt = 0");
await assert.rejects(auth.redeemAffiliateInvite(expired));
const old = await auth.createAffiliateInvite(access);
const oldCookie = await auth.redeemAffiliateInvite(old);
await auth.createAffiliateInvite(access);
await assert.rejects(auth.requireAffiliate(new Request("https://test.example/affiliate-portal", { headers: { Cookie: oldCookie.split(";")[0] } })));
assert.throws(() => auth.checkOrigin(new Request("https://test.example", { headers: { Origin: "https://other.example" } })));
const previousAppUrl = process.env.SHOPIFY_APP_URL;
try {
  process.env.SHOPIFY_APP_URL = "https://trusted-tunnel.example";
  auth.checkOrigin(new Request("http://localhost:3000/affiliate-login", { headers: { Origin: "https://trusted-tunnel.example" } }));
  assert.throws(() => auth.checkOrigin(new Request("http://localhost:3000/affiliate-login", { headers: { Origin: "https://attacker.example", "X-Forwarded-Host": "attacker.example" } })));
  assert.throws(() => auth.checkOrigin(new Request("http://localhost:3000/affiliate-login")));
} finally {
  if (previousAppUrl === undefined) delete process.env.SHOPIFY_APP_URL;
  else process.env.SHOPIFY_APP_URL = previousAppUrl;
}
sql.close();
delete globalThis.__affiliateAccessTest;
console.info("Passed: hashed credentials, invalid/expired/reused links, session login/logout, suspension, reissue revocation, origin protection.");
