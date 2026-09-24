import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import { checkOrigin, logoutAffiliate, privateHeaders, requireAffiliate } from "../models/affiliate-access.server";

export const headers = privateHeaders;
export async function loader({ request }: LoaderFunctionArgs) {
  const { affiliate, store } = await requireAffiliate(request);
  const scope = { affiliateId: affiliate.id, organizationId: affiliate.organizationId };
  const [links, clicks, orders, earnings] = await Promise.all([
    db.affiliateLink.findMany({ where: { affiliateId: affiliate.id, campaign: { organizationId: affiliate.organizationId } }, include: { campaign: true } }),
    db.affiliateClick.count({ where: scope }),
    db.conversion.count({ where: { ...scope, storeId: store.id } }),
    db.commission.groupBy({ by: ["status", "currencyCode"], where: { ...scope, conversion: { storeId: store.id } }, _sum: { amount: true } }),
  ]);
  return { name: affiliate.name, store: store.name ?? store.shopDomain, clicks, orders,
    earnings: earnings.map((item) => ({ status: item.status, currency: item.currencyCode, amount: item._sum.amount?.toFixed(2) ?? "0.00" })),
    links: links.filter((item) => new URL(item.targetUrl).hostname === store.shopDomain).map((item) => {
      const url = new URL(item.targetUrl); url.searchParams.set("ref", item.code);
      if (item.couponCode) url.searchParams.set("coupon", item.couponCode);
      return { id: item.id, campaign: item.campaign.name, status: item.campaign.status, coupon: item.couponCode, url: item.couponCode ? `${url.origin}/discount/${encodeURIComponent(item.couponCode)}?redirect=${encodeURIComponent(url.pathname + url.search)}` : url.toString() };
    }),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  checkOrigin(request);
  return redirect("/affiliate-login", { headers: { ...privateHeaders(), "Set-Cookie": await logoutAffiliate(request) } });
}
export default function AffiliatePortal() {
  const data = useLoaderData<typeof loader>();
  return <main className="affiliate-shell affiliate-portal-shell">
    <header className="affiliate-portal-header">
      <div><p className="affiliate-eyebrow">{data.store}</p><h1>Welcome, {data.name}</h1><p className="affiliate-lead">Here’s how your affiliate activity is performing.</p></div>
      <Form method="post"><button className="affiliate-button affiliate-button--secondary" type="submit">Sign out</button></Form>
    </header>

    <section className="affiliate-stat-grid" aria-label="Affiliate results">
      <article className="affiliate-stat-card"><span>Tracked visits</span><strong>{data.clicks}</strong><small>Recorded campaign visits</small></article>
      <article className="affiliate-stat-card"><span>Attributed orders</span><strong>{data.orders}</strong><small>Includes refunded orders</small></article>
      <article className="affiliate-stat-card"><span>Campaign links</span><strong>{data.links.length}</strong><small>Links assigned to you</small></article>
    </section>

    <section className="affiliate-panel">
      <div className="affiliate-panel-heading"><div><p className="affiliate-eyebrow">Earnings</p><h2>Your commissions</h2></div></div>
      <p className="affiliate-muted">Reversed commissions are not payable. Paid amounts remain visible as historical records.</p>
      <div className="affiliate-earnings-list">
        {data.earnings.length ? data.earnings.map((item) => <div className="affiliate-earning-row" key={`${item.currency}-${item.status}`}><span className={`affiliate-badge affiliate-badge--${item.status.toLowerCase()}`}>{item.status}</span><strong>{item.currency} {item.amount}</strong></div>) : <p className="affiliate-empty">No commissions yet.</p>}
      </div>
    </section>

    <section className="affiliate-panel">
      <div className="affiliate-panel-heading"><div><p className="affiliate-eyebrow">Share and earn</p><h2>Your campaign links</h2></div></div>
      {!data.links.length ? <p className="affiliate-empty">No campaign links assigned yet.</p> : null}
      <div className="affiliate-campaign-list">
        {data.links.map((item) => <article className="affiliate-campaign-card" key={item.id}>
          <div className="affiliate-campaign-title"><h3>{item.campaign}</h3><span className={`affiliate-badge affiliate-badge--${item.status.toLowerCase()}`}>{item.status}</span></div>
          {item.coupon ? <p className="affiliate-coupon">Coupon <strong>{item.coupon}</strong></p> : null}
          <a className="affiliate-link" href={item.url} rel="noreferrer" target="_blank">{item.url}</a>
          <button className="affiliate-button affiliate-button--primary affiliate-button--compact" type="button" onClick={() => { void navigator.clipboard.writeText(item.url).then(() => window.alert("Campaign link copied."), () => window.alert("Please select and copy the link above.")); }}>Copy link</button>
        </article>)}
      </div>
    </section>
  </main>;
}
