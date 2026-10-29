import { boundary } from "@shopify/shopify-app-react-router/server";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useRouteError } from "react-router";

import db from "../db.server";
import { syncCatalog } from "../models/catalog-sync.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";
import { AppIcon } from "../components/AppIcon";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const [products, collections, contents, affiliates, campaigns, clicks, conversions, pendingCommissions] =
    await Promise.all([
      db.product.count({ where: { organizationId: store.organizationId } }),
      db.collection.count({ where: { organizationId: store.organizationId } }),
      db.content.count({ where: { organizationId: store.organizationId } }),
      db.affiliate.count({ where: { organizationId: store.organizationId } }),
      db.campaign.count({ where: { organizationId: store.organizationId } }),
      db.affiliateClick.count({ where: { organizationId: store.organizationId } }),
      db.conversion.count({ where: { organizationId: store.organizationId } }),
      db.commission.count({ where: { organizationId: store.organizationId, status: "PENDING" } }),
    ]);

  return {
    organizationName: store.organization.name,
    shopDomain: store.shopDomain,
    products,
    collections,
    contents,
    affiliates,
    campaigns,
    clicks,
    conversions,
    pendingCommissions,
    lastSyncAt: store.lastSyncAt?.toISOString() ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const result = await syncCatalog(admin, store);

  return { success: true, ...result };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const catalogSync = useFetcher<typeof action>();
  const isSyncing = catalogSync.state !== "idle";
  const syncResult = catalogSync.data;
  const conversionRate = data.clicks ? (data.conversions / data.clicks) * 100 : 0;
  const conversionWidth = Math.min(100, Math.max(data.conversions > 0 ? 4 : 0, conversionRate));

  return (
    <s-page heading="Content Affiliate Hub">
      <div className="merchant-dashboard">
        <section className="merchant-hero">
          <div>
            <div className="merchant-hero-icon"><AppIcon name="sparkles" size={22} /></div>
            <p className="merchant-eyebrow">Program overview</p>
            <h2>Welcome back, {data.organizationName}</h2>
            <p>{data.shopDomain} is connected and ready to track affiliate performance.</p>
          </div>
          <catalogSync.Form method="post">
            <s-button type="submit" variant="primary" disabled={isSyncing}>
              {isSyncing ? "Syncing catalog…" : "Sync catalog"}
            </s-button>
          </catalogSync.Form>
        </section>

        {syncResult?.success ? <s-banner tone="success">Synced {syncResult.productCount} products and {syncResult.collectionCount} collections from Shopify.</s-banner> : null}

        <section className="merchant-kpi-grid" aria-label="Workspace performance">
          <article className="merchant-kpi"><div className="merchant-kpi-icon"><AppIcon name="affiliate" /></div><span>Affiliates</span><strong>{data.affiliates}</strong><small>People in your program</small></article>
          <article className="merchant-kpi"><div className="merchant-kpi-icon"><AppIcon name="campaign" /></div><span>Active campaigns</span><strong>{data.campaigns}</strong><small>Campaigns created</small></article>
          <article className="merchant-kpi"><div className="merchant-kpi-icon"><AppIcon name="click" /></div><span>Tracked visits</span><strong>{data.clicks}</strong><small>Affiliate link visits</small></article>
          <article className="merchant-kpi"><div className="merchant-kpi-icon"><AppIcon name="order" /></div><span>Conversions</span><strong>{data.conversions}</strong><small>Attributed orders</small></article>
          <article className="merchant-kpi merchant-kpi--attention"><div className="merchant-kpi-icon"><AppIcon name="commission" /></div><span>Pending commissions</span><strong>{data.pendingCommissions}</strong><small>Waiting for review</small></article>
        </section>

        <section className="merchant-content-grid">
          <article className="merchant-card">
            <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Quick actions</p><h3>Grow your program</h3></div></div>
            <div className="merchant-action-list">
              <Link to="/app/affiliates"><span><strong>Add an affiliate</strong><small>Invite a new partner and create secure portal access.</small></span><b aria-hidden="true">→</b></Link>
              <Link to="/app/campaigns"><span><strong>Create a campaign</strong><small>Generate a tracked link and optional discount.</small></span><b aria-hidden="true">→</b></Link>
              <Link to="/app/commissions"><span><strong>Review commissions</strong><small>Approve, record, or investigate affiliate earnings.</small></span><b aria-hidden="true">→</b></Link>
            </div>
          </article>

          <article className="merchant-card">
            <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Catalog</p><h3>Store content</h3></div><span className={`merchant-status ${data.lastSyncAt ? "merchant-status--ready" : "merchant-status--pending"}`}>{data.lastSyncAt ? "Synced" : "Setup needed"}</span></div>
            <div className="merchant-catalog-stats"><p><span>Products</span><strong>{data.products}</strong></p><p><span>Collections</span><strong>{data.collections}</strong></p><p><span>Content items</span><strong>{data.contents}</strong></p></div>
            <p className="merchant-caption">{data.lastSyncAt ? `Last synchronized ${new Date(data.lastSyncAt).toLocaleString()}` : "Run catalog sync to import your Shopify products and collections."}</p>
          </article>
        </section>

        <section className="merchant-card merchant-analytics-card" aria-labelledby="performance-heading">
          <div className="merchant-card-heading">
            <div className="merchant-heading-with-icon">
              <span className="merchant-section-icon"><AppIcon name="chart" /></span>
              <div><p className="merchant-eyebrow">Analytics</p><h3 id="performance-heading">Performance snapshot</h3></div>
            </div>
            <p className="merchant-caption">Live totals from tracked referrals and attributed Shopify orders.</p>
          </div>

          <div className="merchant-analytics-grid">
            <div className="merchant-funnel-panel">
              <div className="merchant-funnel-summary">
                <div><span>Conversion rate</span><strong>{conversionRate.toFixed(1)}%</strong></div>
                <div><span>Visits</span><strong>{data.clicks}</strong></div>
                <div><span>Orders</span><strong>{data.conversions}</strong></div>
              </div>
              <div className="merchant-funnel" role="img" aria-label={`${data.clicks} tracked visits produced ${data.conversions} attributed orders, a ${conversionRate.toFixed(1)} percent conversion rate`}>
                <div className="merchant-funnel-row"><span>Tracked visits</span><div><i style={{ width: data.clicks ? "100%" : "0%" }} /></div><strong>{data.clicks}</strong></div>
                <div className="merchant-funnel-row merchant-funnel-row--conversion"><span>Attributed orders</span><div><i style={{ width: `${conversionWidth}%` }} /></div><strong>{data.conversions}</strong></div>
              </div>
            </div>

            <aside className="merchant-insight-panel" aria-label="Program insights">
              <div className="merchant-insight-heading"><AppIcon name="sparkles" size={18} /><strong>Recommended next step</strong></div>
              {data.affiliates === 0 ? <><h4>Recruit your first affiliate</h4><p>Create a partner profile before launching a tracked campaign.</p><Link to="/app/affiliates">Add an affiliate <span aria-hidden="true">→</span></Link></>
                : data.pendingCommissions > 0 ? <><h4>Review pending earnings</h4><p>{data.pendingCommissions} commission{data.pendingCommissions === 1 ? " is" : "s are"} waiting for a merchant decision.</p><Link to="/app/commissions">Review commissions <span aria-hidden="true">→</span></Link></>
                : data.clicks > 0 && data.conversions === 0 ? <><h4>Improve campaign conversion</h4><p>Your links are receiving traffic but have not produced an attributed order yet.</p><Link to="/app/campaigns">Review campaigns <span aria-hidden="true">→</span></Link></>
                : <><h4>Your program is active</h4><p>Tracking is working and there are no commissions waiting for review.</p><Link to="/app/affiliate-dashboard">View affiliate performance <span aria-hidden="true">→</span></Link></>}
            </aside>
          </div>
        </section>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
