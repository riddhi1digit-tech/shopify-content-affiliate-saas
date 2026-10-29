export type CommissionValueType = "PERCENTAGE" | "FIXED";

export type ApplicableCommissionRule = {
  id: string;
  name: string;
  scope: "AFFILIATE" | "PRODUCT";
  type: CommissionValueType;
  value: number;
  priority: number;
  productId: string | null;
};

export type CommissionLine = {
  productId: string | null;
  quantity: number;
  eligibleAmount: number;
};

type CommissionComponent = {
  source: "RULE" | "CAMPAIGN";
  ruleId: string | null;
  ruleName: string;
  scope: "AFFILIATE" | "PRODUCT" | "CAMPAIGN";
  type: CommissionValueType;
  value: number;
  eligibleAmount: number;
  amount: number;
  productId: string | null;
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateValue(
  type: CommissionValueType,
  value: number,
  eligibleAmount: number,
  quantity = 1,
) {
  return money(
    type === "PERCENTAGE"
      ? eligibleAmount * (value / 100)
      : value * quantity,
  );
}

/**
 * Resolves one rule per order line. Product rules outrank affiliate rules,
 * affiliate rules outrank the campaign fallback, and priority breaks ties.
 * The returned component snapshot makes historical commissions reproducible.
 */
export function calculateCommission(input: {
  eligibleAmount: number;
  campaignType: CommissionValueType;
  campaignValue: number;
  lines: CommissionLine[];
  rules: ApplicableCommissionRule[];
}) {
  const rules = [...input.rules].sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
  );
  const affiliateRule = rules.find((rule) => rule.scope === "AFFILIATE");
  const components: CommissionComponent[] = [];
  let unmatchedEligibleAmount = 0;

  const lines = input.lines.length
    ? input.lines
    : [{ productId: null, quantity: 1, eligibleAmount: input.eligibleAmount }];

  for (const line of lines) {
    const productRule = line.productId
      ? rules.find(
          (rule) =>
            rule.scope === "PRODUCT" && rule.productId === line.productId,
        )
      : undefined;
    if (!productRule) {
      unmatchedEligibleAmount += line.eligibleAmount;
      continue;
    }

    components.push({
      source: "RULE",
      ruleId: productRule.id,
      ruleName: productRule.name,
      scope: productRule.scope,
      type: productRule.type,
      value: productRule.value,
      eligibleAmount: money(line.eligibleAmount),
      amount: calculateValue(
        productRule.type,
        productRule.value,
        line.eligibleAmount,
        line.quantity,
      ),
      productId: line.productId,
    });
  }

  if (unmatchedEligibleAmount > 0 && affiliateRule) {
    components.push({
      source: "RULE",
      ruleId: affiliateRule.id,
      ruleName: affiliateRule.name,
      scope: affiliateRule.scope,
      type: affiliateRule.type,
      value: affiliateRule.value,
      eligibleAmount: money(unmatchedEligibleAmount),
      amount: calculateValue(
        affiliateRule.type,
        affiliateRule.value,
        unmatchedEligibleAmount,
      ),
      productId: null,
    });
    unmatchedEligibleAmount = 0;
  }

  if (unmatchedEligibleAmount > 0 || components.length === 0) {
    const eligibleAmount =
      components.length === 0 ? input.eligibleAmount : unmatchedEligibleAmount;
    components.push({
      source: "CAMPAIGN",
      ruleId: null,
      ruleName: "Campaign default",
      scope: "CAMPAIGN",
      type: input.campaignType,
      value: input.campaignValue,
      eligibleAmount: money(eligibleAmount),
      amount: calculateValue(
        input.campaignType,
        input.campaignValue,
        eligibleAmount,
      ),
      productId: null,
    });
  }

  const amount = money(
    components.reduce((sum, component) => sum + component.amount, 0),
  );
  const primary = components[0];
  const usesRules = components.some(({ source }) => source === "RULE");

  return {
    amount,
    type: primary.type,
    rate: primary.value,
    ruleSource: usesRules
      ? components.length > 1
        ? "MIXED_RULES"
        : primary.scope
      : "CAMPAIGN",
    calculationDetails: {
      version: 1,
      eligibleAmount: money(input.eligibleAmount),
      components,
    },
  };
}
