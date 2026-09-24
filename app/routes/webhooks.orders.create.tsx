import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

type ShopifyOrder = {
  id: number | string;
  name?: string;
  currency?: string;
  total_price?: string;
  subtotal_price?: string;
  note_attributes?: Array<{ name: string; value: string }>;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const order = payload as ShopifyOrder;
  const referralCode = order.note_attributes?.find(
    ({ name }) => name === "_cah_ref",
  )?.value;

  console.info(`Received ${topic} webhook for ${shop}`);
  if (!referralCode) return new Response();

  const store = await db.store.findUnique({ where: { shopDomain: shop } });
  if (!store) return new Response();

  const link = await db.affiliateLink.findFirst({
    where: {
      code: referralCode,
      campaign: { organizationId: store.organizationId },
    },
    include: { campaign: true },
  });
  if (!link) return new Response();

  const shopifyOrderId = String(order.id);
  const alreadyProcessed = await db.conversion.findUnique({
    where: { storeId_shopifyOrderId: { storeId: store.id, shopifyOrderId } },
  });
  if (alreadyProcessed) return new Response();

  const orderAmount = Number(order.total_price ?? 0);
  const eligibleAmount = Number(order.subtotal_price ?? order.total_price ?? 0);
  const rate = Number(link.campaign.commissionValue);
  const commissionAmount =
    link.campaign.commissionType === "PERCENTAGE"
      ? Math.round(eligibleAmount * (rate / 100) * 100) / 100
      : rate;
  const click = await db.affiliateClick.findFirst({
    where: { affiliateLinkId: link.id },
    orderBy: { clickedAt: "desc" },
    select: { id: true },
  });

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
      commissions: {
        create: {
          organizationId: store.organizationId,
          affiliateId: link.affiliateId,
          type: link.campaign.commissionType,
          rate,
          amount: commissionAmount,
          currencyCode: order.currency ?? store.currencyCode,
        },
      },
    },
  });

  console.info(`Attributed order ${shopifyOrderId} to ${referralCode}`);
  return new Response();
};
