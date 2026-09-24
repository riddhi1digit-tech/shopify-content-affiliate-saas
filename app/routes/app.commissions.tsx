import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import db from "../db.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const [commissions, payouts] = await Promise.all([
    db.commission.findMany({
      where: { organizationId: store.organizationId },
      include: { affiliate: true, conversion: true },
      orderBy: { createdAt: "desc" },
    }),
    db.payout.findMany({
      where: { organizationId: store.organizationId },
      include: { affiliate: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    commissions: commissions.map((item) => ({
      id: item.id,
      affiliateName: item.affiliate.name,
      orderNumber:
        item.conversion.orderNumber ?? item.conversion.shopifyOrderId,
      amount: Number(item.amount).toFixed(2),
      currency: item.currencyCode,
      eligibleAmount: Number(item.conversion.eligibleAmount).toFixed(2),
      status: item.status,
      orderStatus: item.conversion.status,
    })),
    payouts: payouts.map((item) => ({
      id: item.id,
      affiliateName: item.affiliate.name,
      amount: Number(item.amount).toFixed(2),
      currency: item.currencyCode,
      reference: item.paymentReference,
      method: item.paymentMethod,
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const id = String(form.get("commissionId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reference = String(form.get("reference") ?? "").trim();
  const method = String(form.get("method") ?? "").trim();
  if (!["approve", "paid"].includes(intent))
    return { error: "Invalid action." };
  if (intent === "paid" && (!reference || !method)) {
    return { error: "Payment method and reference are required." };
  }
  try {
    await db.$transaction(async (tx) => {
      const commission = await tx.commission.findFirst({
        where: { id, organizationId: store.organizationId },
        include: { conversion: true },
      });
      if (!commission) throw new Error("Commission not found.");
      if (["REJECTED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(commission.conversion.status))
        throw new Error("This order was cancelled or refunded. Commission payment is blocked.");
      const expectedStatus = intent === "approve" ? "PENDING" : "APPROVED";
      const changed = await tx.commission.updateMany({
        where: {
          id,
          organizationId: store.organizationId,
          status: expectedStatus,
        },
        data: { status: intent === "approve" ? "APPROVED" : "PAID" },
      });
      if (!changed.count)
        throw new Error(
          `Commission must be ${expectedStatus.toLowerCase()} first.`,
        );
      if (intent === "paid") {
        await tx.payout.create({
          data: {
            organizationId: store.organizationId,
            affiliateId: commission.affiliateId,
            status: "PAID",
            currencyCode: commission.currencyCode,
            amount: commission.amount,
            paymentMethod: method,
            paymentReference: reference,
            paidAt: new Date(),
            items: { create: { commissionId: id, amount: commission.amount } },
          },
        });
      }
    });
    return {
      message:
        intent === "approve"
          ? "Commission approved."
          : "Manual payment recorded. No money was sent by the app.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Action failed." };
  }
}

export default function CommissionsPage() {
  const { commissions, payouts } = useLoaderData<typeof loader>();
  const manager = useFetcher<typeof action>();
  const busy = manager.state !== "idle";
  const statusCount = (status: string) => commissions.filter((item) => item.status === status).length;
  return (
    <s-page heading="Commissions & manual payouts">
      <div className="merchant-commissions">
        {manager.data?.error ? (
          <s-banner tone="critical">{manager.data.error}</s-banner>
        ) : manager.data?.message ? (
          <s-banner tone="success">{manager.data.message}</s-banner>
        ) : null}

        <section className="merchant-kpi-grid merchant-kpi-grid--compact" aria-label="Commission summary">
          <article className="merchant-kpi merchant-kpi--attention"><span>Pending</span><strong>{statusCount("PENDING")}</strong><small>Waiting for review</small></article>
          <article className="merchant-kpi"><span>Approved</span><strong>{statusCount("APPROVED")}</strong><small>Ready for external payment</small></article>
          <article className="merchant-kpi"><span>Paid</span><strong>{statusCount("PAID")}</strong><small>Payments recorded</small></article>
          <article className="merchant-kpi"><span>Reversed</span><strong>{statusCount("REVERSED")}</strong><small>Blocked from payment</small></article>
        </section>

        <section className="merchant-commission-notice">
          <div className="merchant-notice-icon" aria-hidden="true">i</div>
          <div><strong>Manual payout workflow</strong><p>Review and approve here, pay the affiliate outside the app, then record the transaction. Refunds block unpaid commission; paid refunds require manual recovery.</p></div>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Review queue</p><h3>Attributed commissions</h3></div><span className="merchant-count">{commissions.length}</span></div>
        {!commissions.length ? (
          <div className="merchant-empty">No attributed commissions yet.</div>
        ) : null}
        <div className="merchant-commission-list">
        {commissions.map((item) => {
          const refunded = ["REJECTED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(item.orderStatus);
          return <article className="merchant-commission-card" key={item.id}>
            <div className="merchant-commission-head"><div><div className="merchant-commission-title"><strong>{item.affiliateName}</strong><span className={`merchant-status merchant-status--${item.status.toLowerCase()}`}>{item.status}</span></div><p>Order #{item.orderNumber}</p></div><div className="merchant-commission-amount"><span>Commission</span><strong>{item.currency} {item.amount}</strong></div></div>
            <div className="merchant-commission-detail"><span>Eligible subtotal <strong>{item.currency} {item.eligibleAmount}</strong></span><span>Order status <strong>{item.orderStatus.replaceAll("_", " ")}</strong></span></div>
            {["REJECTED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(item.orderStatus) ? (
              <div className="merchant-refund-warning"><strong>{item.orderStatus === "REJECTED" ? "Order cancelled" : "Refund recorded"}</strong><span>{item.status === "PAID" ? "Commission was already paid. Review and recover any overpayment manually." : "Payment is blocked. The original amount remains visible for reference."}</span></div>
            ) : null}
            <manager.Form method="post" className="merchant-commission-action">
              <input type="hidden" name="commissionId" value={item.id} />
              {item.status === "PENDING" ? (
                <button className="merchant-button merchant-button--primary" name="intent" value="approve" type="submit" disabled={busy || refunded}>Approve commission</button>
              ) : null}
              {item.status === "APPROVED" ? (
                <div className="merchant-payment-form">
                  <label><span>Payment method</span><input name="method" placeholder="Bank / PayPal / other" required /></label>
                  <label><span>Transaction reference</span><input name="reference" placeholder="Payment reference" required /></label>
                  <button className="merchant-button merchant-button--primary" name="intent" value="paid" type="submit" disabled={busy || refunded}>Record payment sent</button>
                </div>
              ) : null}
            </manager.Form>
          </article>;
        })}
        </div>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Audit trail</p><h3>Payment history</h3></div><span className="merchant-count">{payouts.length}</span></div>
        {!payouts.length ? (
          <div className="merchant-empty">No manual payments recorded.</div>
        ) : null}
        <div className="merchant-payout-list">{payouts.map((item) => <article className="merchant-payout-row" key={item.id}><div><strong>{item.affiliateName}</strong><span>{item.method}</span></div><div><strong>{item.currency} {item.amount}</strong><code>{item.reference}</code></div></article>)}</div>
        </section>
      </div>
    </s-page>
  );
}
