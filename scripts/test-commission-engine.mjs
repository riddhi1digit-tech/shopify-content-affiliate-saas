import assert from "node:assert/strict";

import { calculateCommission } from "../app/models/commission-engine.server.ts";

const base = {
  eligibleAmount: 100,
  campaignType: "PERCENTAGE",
  campaignValue: 10,
};

assert.equal(
  calculateCommission({ ...base, lines: [], rules: [] }).amount,
  10,
  "campaign fallback",
);

assert.equal(
  calculateCommission({
    ...base,
    lines: [{ productId: null, quantity: 1, eligibleAmount: 100 }],
    rules: [{ id: "affiliate", name: "VIP", scope: "AFFILIATE", type: "PERCENTAGE", value: 15, priority: 100, productId: null }],
  }).amount,
  15,
  "affiliate override",
);

assert.equal(
  calculateCommission({
    ...base,
    lines: [
      { productId: "product-1", quantity: 1, eligibleAmount: 50 },
      { productId: "product-2", quantity: 1, eligibleAmount: 50 },
    ],
    rules: [{ id: "product", name: "Featured", scope: "PRODUCT", type: "PERCENTAGE", value: 20, priority: 100, productId: "product-1" }],
  }).amount,
  15,
  "product rule plus campaign fallback",
);

assert.equal(
  calculateCommission({
    ...base,
    lines: [{ productId: "product-1", quantity: 2, eligibleAmount: 40 }],
    rules: [
      { id: "low", name: "Low", scope: "PRODUCT", type: "FIXED", value: 3, priority: 50, productId: "product-1" },
      { id: "high", name: "High", scope: "PRODUCT", type: "FIXED", value: 4, priority: 200, productId: "product-1" },
    ],
  }).amount,
  8,
  "highest-priority fixed product rule per quantity",
);

console.log("Commission engine tests passed.");
