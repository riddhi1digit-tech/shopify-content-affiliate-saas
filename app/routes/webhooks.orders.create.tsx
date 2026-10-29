import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { calculateCommission } from "../models/commission-engine.server";
import { assessOrderRisk } from "../models/fraud-protection.server";
import { logWebhook } from "../models/webhook-log.server";
import { authenticate } from "../shopify.server";

function isDuplicateOrder(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002",
  );
}

type ShopifyOrder = {
  id: number | string;
  name?: string;
  currency?: string;
  total_price?: string;
  subtotal_price?: string;
  note_attributes?: Array<{ name: string; value: string }>;
  line_items?: Array<{
    product_id?: number | string | null;
    quantity?: number;
    price?: string;
    total_discount?: string;
  }>;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const order = payload as ShopifyOrder;
  const referralCode = order.note_attributes?.find(
    ({ name }) => name === "_cah_ref",
  )?.value;
  const sessionKey = order.note_attributes?.find(
    ({ name }) => name === "_cah_session",
  )?.value?.slice(0, 100) ?? "";

  logWebhook(request, "received", { topic, shop });
  if (!referralCode) {
    logWebhook(request, "ignored_missing_referral", { topic, shop });
    return new Response();
  }

  const store = await db.store.findUnique({
    where: { shopDomain: shop },
    include: { organization: { select: { attributionDays: true } } },
  });
  if (!store) {
    logWebhook(request, "ignored_unknown_store", { topic, shop });
    return new Response();
  }

  const link = await db.affiliateLink.findFirst({
    where: {
      code: referralCode,
      campaign: { organizationId: store.organizationId },
    },
    include: { campaign: true },
  });
  if (!link) {
    logWebhook(request, "ignored_unknown_referral", { topic, shop });
    return new Response();
  }

  const shopifyOrderId = String(order.id);
  const alreadyProcessed = await db.conversion.findUnique({
    where: { storeId_shopifyOrderId: { storeId: store.id, shopifyOrderId } },
  });
  if (alreadyProcessed) {
    logWebhook(request, "ignored_duplicate_order", { topic, shop, orderId: shopifyOrderId });
    return new Response();
  }

  const orderAmount = Number(order.total_price ?? 0);
  const eligibleAmount = Number(order.subtotal_price ?? order.total_price ?? 0);
  const campaignRate = Number(link.campaign.commissionValue);
  if (
    !Number.isFinite(orderAmount) ||
    !Number.isFinite(eligibleAmount) ||
    !Number.isFinite(campaignRate) ||
    orderAmount < 0 ||
    eligibleAmount < 0 ||
    campaignRate < 0
  ) {
    logWebhook(request, "rejected_invalid_amount", { topic, shop, orderId: shopifyOrderId }, "error");
    return new Response();
  }
  const rawProductIds = (order.line_items ?? [])
    .map(({ product_id }) => product_id == null ? null : String(product_id))
    .filter((id): id is string => Boolean(id));
  const shopifyProductIds = [
    ...rawProductIds,
    ...rawProductIds.map((id) => `gid://shopify/Product/${id}`),
  ];
  const now = new Date();
  const [products, rules] = await Promise.all([
    shopifyProductIds.length
      ? db.product.findMany({
          where: { storeId: store.id, shopifyId: { in: shopifyProductIds } },
          select: { id: true, shopifyId: true },
        })
      : Promise.resolve([]),
    db.commissionRule.findMany({
      where: {
        organizationId: store.organizationId,
        active: true,
        AND: [
          { OR: [{ campaignId: null }, { campaignId: link.campaignId }] },
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          {
            OR: [
              { scope: "AFFILIATE", affiliateId: link.affiliateId },
              {
                scope: "PRODUCT",
                product: {
                  storeId: store.id,
                  shopifyId: { in: shopifyProductIds },
                },
              },
            ],
          },
        ],
      },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        scope: true,
        type: true,
        value: true,
        priority: true,
        productId: true,
      },
    }),
  ]);
  const productIdMap = new Map<string, string>();
  for (const product of products) {
    productIdMap.set(product.shopifyId, product.id);
    productIdMap.set(product.shopifyId.replace("gid://shopify/Product/", ""), product.id);
  }
  const commissionLines = (order.line_items ?? []).map((line) => {
    const parsedQuantity = Number(line.quantity ?? 1);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0
      ? Math.floor(parsedQuantity)
      : 1;
    const parsedPrice = Number(line.price ?? 0);
    const parsedDiscount = Number(line.total_discount ?? 0);
    const lineSubtotal = (Number.isFinite(parsedPrice) ? parsedPrice : 0) * quantity;
    const lineDiscount = Number.isFinite(parsedDiscount) ? parsedDiscount : 0;
    const rawProductId = line.product_id == null ? "" : String(line.product_id);
    return {
      productId: productIdMap.get(rawProductId) ?? null,
      quantity,
      eligibleAmount: Math.max(0, lineSubtotal - lineDiscount),
    };
  });
  const linesTotal = commissionLines.reduce(
    (sum, line) => sum + line.eligibleAmount,
    0,
  );
  if (linesTotal - eligibleAmount > 0.009 && linesTotal > 0) {
    const scale = eligibleAmount / linesTotal;
    for (const line of commissionLines) line.eligibleAmount *= scale;
  } else if (eligibleAmount - linesTotal > 0.009) {
    commissionLines.push({
      productId: null,
      quantity: 1,
      eligibleAmount: eligibleAmount - linesTotal,
    });
  }
  const calculation = calculateCommission({
    eligibleAmount,
    campaignType: link.campaign.commissionType,
    campaignValue: campaignRate,
    lines: commissionLines,
    rules: rules.map((rule) => ({
      ...rule,
      value: Number(rule.value),
    })),
  });
  const click = await db.affiliateClick.findFirst({
    where: {
      affiliateLinkId: link.id,
      ...(sessionKey ? { sessionKey } : {}),
    },
    orderBy: { clickedAt: "desc" },
    select: { id: true, clickedAt: true },
  });
  const risk = await assessOrderRisk({
    organizationId: store.organizationId,
    affiliateId: link.affiliateId,
    affiliateLinkId: link.id,
    referralCode,
    sessionKey,
    click,
    attributionDays: store.organization.attributionDays,
  });

  try {
    await db.conversion.create({
      data: {
        organizationId: store.organizationId,
        storeId: store.id,
        affiliateId: link.affiliateId,
        campaignId: link.campaignId,
        clickId: click?.id,
        shopifyOrderId,
        orderNumber: order.name,
        currencyCode: order.currency ?? store.currencyCode,
        orderAmount,
        eligibleAmount,
        riskStatus: risk.status,
        riskScore: risk.score,
        fraudEvents: risk.signals.length
          ? {
              create: risk.signals.map((signal) => ({
                organizationId: store.organizationId,
                affiliateId: link.affiliateId,
                clickId: click?.id,
                type: signal.type,
                severity: signal.severity,
                score: signal.score,
                reason: signal.reason,
                evidence: signal.evidence,
              })),
            }
          : undefined,
        commissions: {
          create: {
            organizationId: store.organizationId,
            affiliateId: link.affiliateId,
            type: calculation.type,
            rate: calculation.rate,
            amount: calculation.amount,
            currencyCode: order.currency ?? store.currencyCode,
            ruleSource: calculation.ruleSource,
            calculationDetails: calculation.calculationDetails,
            status: risk.commissionStatus,
          },
        },
      },
    });
  } catch (error) {
    // Shopify can deliver the same webhook concurrently. The database unique
    // constraint is the final idempotency guard; acknowledge that duplicate.
    if (isDuplicateOrder(error)) {
      logWebhook(request, "ignored_concurrent_duplicate", { topic, shop, orderId: shopifyOrderId });
      return new Response();
    }
    throw error;
  }

  logWebhook(request, "order_attributed", {
    topic,
    shop,
    orderId: shopifyOrderId,
    riskScore: risk.score,
    riskStatus: risk.status,
  });
  return new Response();
};
