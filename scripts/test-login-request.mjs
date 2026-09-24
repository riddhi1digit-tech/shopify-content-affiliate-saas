import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";

const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE AffiliateLoginLimit (id TEXT PRIMARY KEY, windowStart BIGINT, count INTEGER)");
let sent = 0;
let inactive = false;
let fail = false;
const client = {
  $executeRaw: async (parts, ...values) => Number(sql.prepare(parts.join("?")).run(...values).changes),
  $queryRaw: async (parts, ...values) => sql.prepare(parts.join("?")).all(...values),
  store: { findFirst: async ({ where }) => where.shopDomain === "test.myshopify.com" ? { id: "store", organizationId: "org" } : null },
  affiliate: { findFirst: async ({ where }) => !inactive && where.organizationId === "org" && where.email === "affiliate@example.com" ? { id: "affiliate", name: "Affiliate", email: where.email } : null },
};
client.$transaction = async (callback) => {
  sql.exec("BEGIN");
  try { const result = await callback(client); sql.exec("COMMIT"); return result; }
  catch (error) { sql.exec("ROLLBACK"); throw error; }
};
globalThis.__loginRequestTest = {
  db: client,
  createAffiliateInvite: async (access, revoke) => { assert.equal(revoke, false); assert.equal(access.organizationId, "org"); return "test-token"; },
  emailConfiguration() {},
  sendAffiliateLoginEmail: async (input) => { assert.equal(input.email, "affiliate@example.com"); if (fail) throw new Error("provider-secret"); sent++; },
};
const source = await readFile(new URL("../app/models/affiliate-login-request.server.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source.replace('import db from "../db.server";', "const db = globalThis.__loginRequestTest.db;").replace('import { createAffiliateInvite } from "./affiliate-access.server";', "const { createAffiliateInvite } = globalThis.__loginRequestTest;").replace('import { emailConfiguration, sendAffiliateLoginEmail } from "./affiliate-email.server";', "const { emailConfiguration, sendAffiliateLoginEmail } = globalThis.__loginRequestTest;"));
const service = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const request = (shop = "test.myshopify.com", email = "affiliate@example.com") => service.requestAffiliateLogin(shop, email, "https://app.example");
assert.equal(await request("other.myshopify.com"), service.requestMessage);
assert.equal(await request(undefined, "unknown@example.com"), service.requestMessage);
inactive = true;
assert.equal(await request(), service.requestMessage);
inactive = false;
sql.exec("DELETE FROM AffiliateLoginLimit");
for (let i = 0; i < 4; i++) assert.equal(await request(), service.requestMessage);
assert.equal(sent, 3);
sql.exec("UPDATE AffiliateLoginLimit SET windowStart = 0");
assert.equal(await request(), service.requestMessage);
assert.equal(sent, 4);
fail = true;
assert.equal(await request(), service.requestMessage);
assert.equal(sent, 4);
assert.ok(sql.prepare("SELECT id FROM AffiliateLoginLimit").all().every((row) => !row.id.includes("affiliate@example.com")));
sql.close();
delete globalThis.__loginRequestTest;
console.info("Passed: tenant eligibility, inactive/unknown recipients, generic outcomes, persistent throttling/reset, hashed rate keys, session preservation option. No emails sent.");
