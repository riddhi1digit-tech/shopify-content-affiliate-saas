import db from "../db.server";

/** Conservative MVP policy: any refund blocks unpaid commission, without guessing
 * a partial-refund amount. Paid amounts and payment history are never rewritten. */
export async function protectOrderCommission(
  shop: string,
  orderId: string,
  reason: "refund" | "cancelled",
) {
  return db.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { shopDomain: shop } });
    if (!store) return;
    const conversion = await tx.conversion.findUnique({
      where: { storeId_shopifyOrderId: { storeId: store.id, shopifyOrderId: orderId } },
    });
    if (!conversion) return;
    // A later refund must not overwrite a cancellation. Repeated delivery is safe.
    await tx.conversion.update({
      where: { id: conversion.id },
      data: { status: reason === "cancelled" || conversion.status === "REJECTED" ? "REJECTED" : "REFUNDED" },
    });
    await tx.commission.updateMany({
      where: { conversionId: conversion.id, status: { in: ["PENDING", "APPROVED"] } },
      data: { status: "REVERSED" },
    });
    console.info(`Commission protection: ${reason} order ${orderId} for ${shop}`);
  });
}
