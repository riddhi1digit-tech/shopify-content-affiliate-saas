import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../app/models/affiliate-email.server.ts", import.meta.url), "utf8");
const moduleCode = stripTypeScriptTypes(source);
const email = await import(`data:text/javascript;base64,${Buffer.from(moduleCode).toString("base64")}`);
const previousKey = process.env.RESEND_API_KEY;
const previousFrom = process.env.AFFILIATE_EMAIL_FROM;
const originalFetch = globalThis.fetch;
try {
  delete process.env.RESEND_API_KEY;
  delete process.env.AFFILIATE_EMAIL_FROM;
  assert.throws(email.emailConfiguration, /Configure/);
  process.env.RESEND_API_KEY = "test-key-not-real";
  process.env.AFFILIATE_EMAIL_FROM = "Test <login@example.com>";
  let calls = 0;
  const input = { email: "affiliate@example.com", name: '<script>alert("x")</script>', storeName: "Shop & Store", loginUrl: "https://app.example.com/affiliate-login#token=private-test-token" };
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, [input.email]);
    assert.equal(payload.from, process.env.AFFILIATE_EMAIL_FROM);
    assert.ok(!payload.html.includes("<script>"));
    assert.ok(payload.html.includes("Shop &amp; Store"));
    assert.ok(payload.text.includes(input.loginUrl));
    assert.ok(!options.headers["Idempotency-Key"].includes("private-test-token"));
    return { ok: true, json: async () => ({ id: "test-message" }) };
  };
  assert.equal(await email.sendAffiliateLoginEmail(input), "test-message");
  await assert.rejects(email.sendAffiliateLoginEmail({ ...input, loginUrl: "http://unsafe.example.com" }), /secure/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  await assert.rejects(email.sendAffiliateLoginEmail(input), /HTTP 403/);
  globalThis.fetch = async () => { throw new Error("secret-provider-details"); };
  await assert.rejects(email.sendAffiliateLoginEmail(input), (error) => !error.message.includes("secret-provider-details") && error.message.includes("could not be confirmed"));
  console.info("Passed: missing configuration, recipient/sender payload, escaping, hashed idempotency key, unsafe URL rejection, provider and network errors. No email sent.");
} finally {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
  if (previousFrom === undefined) delete process.env.AFFILIATE_EMAIL_FROM; else process.env.AFFILIATE_EMAIL_FROM = previousFrom;
}
