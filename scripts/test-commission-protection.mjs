import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Run the actual handler against a transaction double: never modify merchant data.
const source = await readFile(new URL("../app/models/commission-protection.server.ts", import.meta.url), "utf8");
let state;
const tx = {
  store: { findUnique: async ({ where }) => where.shopDomain === "test.myshopify.com" ? { id: "store" } : null },
  conversion: {
    findUnique: async ({ where }) => where.storeId_shopifyOrderId.shopifyOrderId === "1001" ? state.conversion : null,
    update: async ({ data }) => Object.assign(state.conversion, data),
  },
  commission: {
    updateMany: async ({ where, data }) => {
      for (const item of state.commissions) {
        if (item.conversionId === where.conversionId && where.status.in.includes(item.status)) Object.assign(item, data);
      }
    },
  },
};
globalThis.__protectionTestDb = { $transaction: async (callback) => callback(tx) };
const code = stripTypeScriptTypes(source.replace('import db from "../db.server";', "const db = globalThis.__protectionTestDb;"));
const { protectOrderCommission } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
state = {
  conversion: { id: "conversion", status: "PENDING" },
  commissions: ["PENDING", "APPROVED", "PAID"].map((status) => ({ conversionId: "conversion", status, amount: 67.5 })),
};
await protectOrderCommission("other.myshopify.com", "1001", "refund");
await protectOrderCommission("test.myshopify.com", "unknown", "refund");
assert.equal(state.conversion.status, "PENDING");
await protectOrderCommission("test.myshopify.com", "1001", "refund");
assert.equal(state.conversion.status, "REFUNDED");
assert.deepEqual(state.commissions.map((item) => item.status), ["REVERSED", "REVERSED", "PAID"]);
await protectOrderCommission("test.myshopify.com", "1001", "refund");
await protectOrderCommission("test.myshopify.com", "1001", "cancelled");
await protectOrderCommission("test.myshopify.com", "1001", "refund");
assert.equal(state.conversion.status, "REJECTED");
assert.ok(state.commissions.every((item) => item.amount === 67.5));
delete globalThis.__protectionTestDb;
console.info("Passed: tenant/order isolation, unpaid protection, paid preservation, duplicate delivery, cancellation precedence.");
