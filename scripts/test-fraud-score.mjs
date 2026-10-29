import assert from "node:assert/strict";

import { summarizeFraudRisk } from "../app/models/fraud-score.ts";

assert.deepEqual(summarizeFraudRisk([]), {
  score: 0,
  status: "CLEAR",
  commissionStatus: "PENDING",
});
assert.equal(summarizeFraudRisk([{ score: 20 }, { score: 30 }]).status, "REVIEW");
assert.equal(summarizeFraudRisk([{ score: 20 }, { score: 30 }]).commissionStatus, "HELD");
assert.equal(summarizeFraudRisk([{ score: 70 }, { score: 35 }]).score, 100);
assert.equal(summarizeFraudRisk([{ score: 100 }]).status, "BLOCKED");

console.log("Fraud score tests passed.");
