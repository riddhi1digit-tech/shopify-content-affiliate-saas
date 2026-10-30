import db from "../db.server";

type LoyaltyOrder = {
  id: number | string;
  subtotal_price?: string;
  total_price?: string;
  customer?: { id?: number | string; email?: string | null } | null;
};

function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function awardOrderPoints(store: { id: string; organizationId: string }, order: LoyaltyOrder) {
  const customerId = order.customer?.id == null ? "" : String(order.customer.id);
  if (!customerId) return { awarded: 0, reason: "guest" };
  const program = await db.loyaltyProgram.findUnique({ where: { organizationId: store.organizationId } });
  if (!program?.active) return { awarded: 0, reason: "inactive" };
  const customer = await db.loyaltyCustomer.upsert({
    where: { storeId_shopifyCustomerId: { storeId: store.id, shopifyCustomerId: customerId } },
    update: { email: order.customer?.email ?? undefined },
    create: { organizationId: store.organizationId, storeId: store.id, shopifyCustomerId: customerId, email: order.customer?.email ?? undefined },
  });
  const tier = await db.vipTier.findFirst({ where: { organizationId: store.organizationId, threshold: { lte: customer.lifetimePoints } }, orderBy: { threshold: "desc" } });
  const amount = Number(order.subtotal_price ?? order.total_price ?? 0);
  const points = Math.floor(amount * Number(program.pointsPerCurrency) * Number(tier?.multiplier ?? 1));
  if (!Number.isFinite(amount) || amount < 0 || points <= 0) return { awarded: 0, reason: "zero" };
  const nextTier = await db.vipTier.findFirst({ where: { organizationId: store.organizationId, threshold: { lte: customer.lifetimePoints + points } }, orderBy: { threshold: "desc" } });
  try {
    await db.$transaction([
      db.loyaltyTransaction.create({ data: { organizationId: store.organizationId, loyaltyCustomerId: customer.id, type: "EARN", points, shopifyOrderId: String(order.id), description: `Earned from Shopify order ${order.id}` } }),
      db.loyaltyCustomer.update({ where: { id: customer.id }, data: { pointsBalance: { increment: points }, lifetimePoints: { increment: points }, tierId: nextTier?.id } }),
    ]);
  } catch (error) {
    if (isUniqueConflict(error)) return { awarded: 0, reason: "duplicate" };
    throw error;
  }
  return { awarded: points, reason: "earned" };
}

export async function reverseOrderPoints(store: { id: string; organizationId: string }, shopifyOrderId: string, reason: "REFUND" | "CANCEL") {
  const earned = await db.loyaltyTransaction.findMany({ where: { organizationId: store.organizationId, shopifyOrderId, type: "EARN" } });
  for (const item of earned) {
    try {
      await db.$transaction([
        db.loyaltyTransaction.create({ data: { organizationId: store.organizationId, loyaltyCustomerId: item.loyaltyCustomerId, type: "REVERSAL", points: -item.points, shopifyOrderId, description: `${reason === "REFUND" ? "Refund" : "Cancellation"} reversal for Shopify order ${shopifyOrderId}` } }),
        db.loyaltyCustomer.update({ where: { id: item.loyaltyCustomerId }, data: { pointsBalance: { decrement: item.points }, lifetimePoints: { decrement: item.points } } }),
      ]);
    } catch (error) { if (!isUniqueConflict(error)) throw error; }
  }
}
