import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const code = await readFile(new URL("../extensions/coupon-banner/assets/coupon-banner.js", import.meta.url), "utf8");
async function visit(search, coupon, saved = null, failCart = false) {
  const elements = Object.fromEntries(["[data-cah-offer-message]", "[data-cah-coupon-code]", "[data-cah-copy]", "[data-cah-tracking-status]"].map((key) => [key, { hidden: false, textContent: "", addEventListener() {} }]));
  let hidden;
  const banner = { dataset: { defaultCode: "TEST10" }, querySelector: (key) => elements[key], classList: { toggle: (_, value) => { hidden = value; } } };
  const storage = new Map(saved ? [["cah_campaign", JSON.stringify(saved)]] : []);
  const calls = [];
  const context = vm.createContext({
    window: { location: { search, pathname: "/products/test" }, Shopify: { routes: { root: "/en/" } } },
    document: { querySelectorAll: () => [banner, banner], referrer: "", cookie: "" },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    URLSearchParams, crypto: { randomUUID: () => "session" }, navigator: { clipboard: { writeText: async () => {} } },
    console: { error() {} },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url.startsWith("/apps/") ? { ok: true, json: async () => ({ tracked: true, couponCode: coupon }) } : { ok: !failCart };
    },
  });
  vm.runInContext(code, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, calls, hidden, storage };
}
const getnew = await visit("?ref=one&coupon=FAKE", "GETNEW");
assert.equal(getnew.elements["[data-cah-coupon-code]"].textContent, "GETNEW");
assert.equal(JSON.parse(getnew.calls[1].options.body).discount, "GETNEW");
assert.equal(getnew.calls[1].url, "/en/cart/update.js");
assert.equal(getnew.calls.length, 2, "Multiple blocks must not double-track");
const free = await visit("?ref=two", null, { ref: "one", coupon: "GETNEW", expiresAt: Date.now() + 60000 });
assert.equal(JSON.parse(free.calls[1].options.body).discount, "");
assert.equal(JSON.parse(free.calls[1].options.body).attributes._cah_ref, "two");
assert.equal(free.elements["[data-cah-coupon-code]"].hidden, true);
const browse = await visit("", null, { ref: "two", coupon: "", expiresAt: Date.now() + 60000 });
assert.equal(browse.hidden, true);
assert.equal(browse.calls.length, 0, "Browsing must not reset manually entered discounts");
const nextPage = await visit("", null, { ref: "one", coupon: "GETNEW", expiresAt: Date.now() + 60000 });
assert.equal(nextPage.elements["[data-cah-coupon-code]"].textContent, "GETNEW");
const failed = await visit("?ref=one", "GETNEW", null, true);
assert.equal(failed.elements["[data-cah-coupon-code]"].hidden, true);
assert.match(failed.elements["[data-cah-tracking-status]"].textContent, /unavailable/);
console.info("Passed: authoritative coupon, discount replacement/clearing, coupon-free navigation, persistence, multi-block dedup, locale paths, cart failure.");
