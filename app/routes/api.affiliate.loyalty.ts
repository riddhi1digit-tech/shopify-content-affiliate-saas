import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopDomain = String(url.searchParams.get("shop") ?? "").toLowerCase();
  const customerId = String(url.searchParams.get("logged_in_customer_id") ?? "");
  if (!shopDomain || !customerId) return Response.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const store = await db.store.findUnique({ where: { shopDomain }, select: { id: true, organizationId: true, currencyCode: true } });
  if (!store) return Response.json({ authenticated: true, enabled: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const [program, customer] = await Promise.all([
    db.loyaltyProgram.findUnique({ where: { organizationId: store.organizationId } }),
    db.loyaltyCustomer.findUnique({ where: { storeId_shopifyCustomerId: { storeId: store.id, shopifyCustomerId: customerId } }, include: { tier: true } }),
  ]);
  if (!program?.active) return Response.json({ authenticated: true, enabled: false }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({
    authenticated: true,
    enabled: true,
    pointsName: program.pointsName,
    balance: customer?.pointsBalance ?? 0,
    lifetime: customer?.lifetimePoints ?? 0,
    tier: customer?.tier?.name ?? "Member",
    reward: { points: program.redemptionPoints, value: Number(program.redemptionValue), currencyCode: store.currencyCode, eligible: (customer?.pointsBalance ?? 0) >= program.redemptionPoints },
  }, { headers: { "Cache-Control": "no-store" } });
};
