import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";

function referralUrl(targetUrl: string, code: string, coupon: string | null) {
  const url = new URL(targetUrl);
  url.searchParams.set("ref", code);
  if (!coupon) return url.toString();
  url.searchParams.set("coupon", coupon);
  return `${url.origin}/discount/${encodeURIComponent(coupon)}?redirect=${encodeURIComponent(url.pathname + url.search)}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const affiliates = await db.affiliate.findMany({
    where: { organizationId: store.organizationId },
    select: { id: true, name: true, code: true, status: true },
    orderBy: { name: "asc" },
  });
  const id = new URL(request.url).searchParams.get("affiliateId") ?? affiliates[0]?.id;
  const affiliate = affiliates.find((item) => item.id === id);
  if (id && !affiliate) throw new Response("Affiliate not found", { status: 404 });
  if (!affiliate) return { affiliates, affiliate: null, links: [], clicks: 0, conversions: 0, earnings: [], orders: [] };
  const scope = { organizationId: store.organizationId, affiliateId: affiliate.id };
  const [links, clicks, conversions, earnings, orders] = await Promise.all([
    db.affiliateLink.findMany({
      where: { affiliateId: affiliate.id, campaign: { organizationId: store.organizationId } },
      include: { campaign: true, _count: { select: { clicks: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.affiliateClick.count({ where: scope }),
    db.conversion.count({ where: scope }),
    db.commission.groupBy({ by: ["currencyCode", "status"], where: scope, _sum: { amount: true } }),
    db.commission.findMany({ where: scope, include: { conversion: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    affiliates, affiliate, clicks, conversions,
    links: links.map((link) => ({ id: link.id, name: link.campaign.name, status: link.campaign.status, url: referralUrl(link.targetUrl, link.code, link.couponCode), coupon: link.couponCode, clicks: link._count.clicks })),
    earnings: earnings.map((group) => ({ currency: group.currencyCode, status: group.status, amount: group._sum.amount?.toFixed(2) ?? "0.00" })),
    orders: orders.map((item) => ({ id: item.id, order: item.conversion.orderNumber ?? item.conversion.shopifyOrderId, currency: item.currencyCode, amount: item.amount.toFixed(2), status: item.status, refundedOrCancelled: ["REJECTED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(item.conversion.status) })),
  };
}

export default function AffiliateDashboard() {
  const { affiliates, affiliate, links, clicks, conversions, earnings, orders } = useLoaderData<typeof loader>();
  const conversionRate = clicks ? ((conversions / clicks) * 100).toFixed(1) : "0.0";
  return <s-page heading="Affiliate dashboard">
    <div className="merchant-affiliate-dashboard">
      <section className="merchant-affiliate-selector">
        <div><p className="merchant-eyebrow">Merchant view</p><h2>Affiliate performance</h2><p>Review the same performance data affiliates see in their secure portal.</p></div>
        {affiliates.length ? <Form method="get" className="merchant-selector-form">
          <label><span>Affiliate</span><select name="affiliateId" defaultValue={affiliate?.id} key={affiliate?.id}>{affiliates.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label>
          <button className="merchant-button merchant-button--primary" type="submit">View dashboard</button>
        </Form> : <a className="merchant-button merchant-button--primary" href="/app/affiliates">Create affiliate</a>}
      </section>

      {affiliate ? <>
        <section className="merchant-profile-strip"><div className="merchant-avatar merchant-avatar--large" aria-hidden="true">{affiliate.name.slice(0, 2).toUpperCase()}</div><div><div className="merchant-profile-name"><h3>{affiliate.name}</h3><span className={`merchant-status merchant-status--${affiliate.status.toLowerCase()}`}>{affiliate.status}</span></div><p>Referral code <code>{affiliate.code}</code></p></div></section>

        <section className="merchant-kpi-grid merchant-kpi-grid--compact" aria-label="Affiliate performance summary">
          <article className="merchant-kpi"><span>Tracked visits</span><strong>{clicks}</strong><small>Recorded link visits</small></article>
          <article className="merchant-kpi"><span>Attributed orders</span><strong>{conversions}</strong><small>Includes refunded orders</small></article>
          <article className="merchant-kpi"><span>Conversion rate</span><strong>{conversionRate}%</strong><small>Orders divided by visits</small></article>
          <article className="merchant-kpi"><span>Campaign links</span><strong>{links.length}</strong><small>Assigned tracking links</small></article>
        </section>

        <section className="merchant-dashboard-grid">
          <article className="merchant-card">
            <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Earnings</p><h3>Commission totals</h3></div></div>
            <p className="merchant-caption">Totals are separated by currency and status. Reversed commissions are not payable.</p>
            {!earnings.length ? <div className="merchant-empty">No commissions yet.</div> : <div className="merchant-earning-list">{earnings.map((item) => <div key={`${item.currency}-${item.status}`}><span className={`merchant-status merchant-status--${item.status.toLowerCase()}`}>{item.status}</span><strong>{item.currency} {item.amount}</strong></div>)}</div>}
          </article>

          <article className="merchant-card">
            <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Recent activity</p><h3>Latest commissions</h3></div><span className="merchant-count">{orders.length}</span></div>
            {!orders.length ? <div className="merchant-empty">No attributed orders yet.</div> : <div className="merchant-order-list">{orders.map((item) => <div key={item.id}><span><strong>Order #{item.order}</strong><small>{item.refundedOrCancelled ? "Refund or cancellation recorded" : "Attributed order"}</small></span><span><strong>{item.currency} {item.amount}</strong><em className={`merchant-status merchant-status--${item.status.toLowerCase()}`}>{item.status}</em></span></div>)}</div>}
          </article>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Share and track</p><h3>Campaign links</h3></div><span className="merchant-count">{links.length}</span></div>
          {!links.length ? <div className="merchant-empty">No campaign links assigned.</div> : <div className="merchant-dashboard-link-list">{links.map((item) => <article key={item.id}><div className="merchant-dashboard-link-head"><div><strong>{item.name}</strong><span className={`merchant-status merchant-status--${item.status.toLowerCase()}`}>{item.status}</span></div><span><b>{item.clicks}</b> visits</span></div><div className="merchant-dashboard-link-body">{item.coupon ? <p>Coupon <code>{item.coupon}</code></p> : <p>No coupon</p>}<a href={item.url} target="_blank" rel="noreferrer">{item.url}</a><button className="merchant-button merchant-button--secondary" type="button" onClick={() => { void navigator.clipboard.writeText(item.url).then(() => window.alert("Campaign link copied."), () => window.alert("Select and copy the link above.")); }}>Copy link</button></div></article>)}</div>}
        </section>
      </> : null}
    </div>
  </s-page>;
}
