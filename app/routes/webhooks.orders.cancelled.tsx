import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { protectOrderCommission } from "../models/commission-protection.server";

export async function action({ request }: ActionFunctionArgs) {
  const { payload, shop } = await authenticate.webhook(request);
  const order = payload as { id?: string | number };
  if (order.id != null) {
    await protectOrderCommission(shop, String(order.id), "cancelled");
  }
  return new Response();
}
