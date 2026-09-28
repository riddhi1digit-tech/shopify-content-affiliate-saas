import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { protectOrderCommission } from "../models/commission-protection.server";
import { logWebhook } from "../models/webhook-log.server";

export async function action({ request }: ActionFunctionArgs) {
  const { payload, shop } = await authenticate.webhook(request);
  const refund = payload as { order_id?: string | number };
  if (refund.order_id != null) {
    await protectOrderCommission(shop, String(refund.order_id), "refund");
    logWebhook(request, "refund_protection_applied", { shop, orderId: String(refund.order_id) });
  } else {
    logWebhook(request, "ignored_missing_order_id", { shop, topic: "REFUNDS_CREATE" });
  }
  return new Response();
}
