import { boundary } from "@shopify/shopify-app-react-router/server";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";

import db from "../db.server";
import { syncCatalog } from "../models/catalog-sync.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";

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

  return (
    <s-page heading="Content Affiliate Hub">
      <div className="merchant-dashboard">
        <section className="merchant-hero">
          <div>
            <p className="merchant-eyebrow">Overview</p>
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
          <article className="merchant-kpi"><span>Affiliates</span><strong>{data.affiliates}</strong><small>People in your program</small></article>
          <article className="merchant-kpi"><span>Active campaigns</span><strong>{data.campaigns}</strong><small>Campaigns created</small></article>
          <article className="merchant-kpi"><span>Tracked visits</span><strong>{data.clicks}</strong><small>Affiliate link visits</small></article>
          <article className="merchant-kpi"><span>Conversions</span><strong>{data.conversions}</strong><small>Attributed orders</small></article>
          <article className="merchant-kpi merchant-kpi--attention"><span>Pending commissions</span><strong>{data.pendingCommissions}</strong><small>Waiting for review</small></article>
        </section>

        <section className="merchant-content-grid">
          <article className="merchant-card">
            <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Quick actions</p><h3>Grow your program</h3></div></div>
            <div className="merchant-action-list">
              <a href="/app/affiliates"><span><strong>Add an affiliate</strong><small>Invite a new partner and create secure portal access.</small></span><b aria-hidden="true">→</b></a>
              <a href="/app/campaigns"><span><strong>Create a campaign</strong><small>Generate a tracked link and optional discount.</small></span><b aria-hidden="true">→</b></a>
              <a href="/app/commissions"><span><strong>Review commissions</strong><small>Approve, record, or investigate affiliate earnings.</small></span><b aria-hidden="true">→</b></a>
            </div>
          </article>

          <article className="merchant-card">
            <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Catalog</p><h3>Store content</h3></div><span className={`merchant-status ${data.lastSyncAt ? "merchant-status--ready" : "merchant-status--pending"}`}>{data.lastSyncAt ? "Synced" : "Setup needed"}</span></div>
            <div className="merchant-catalog-stats"><p><span>Products</span><strong>{data.products}</strong></p><p><span>Collections</span><strong>{data.collections}</strong></p><p><span>Content items</span><strong>{data.contents}</strong></p></div>
            <p className="merchant-caption">{data.lastSyncAt ? `Last synchronized ${new Date(data.lastSyncAt).toLocaleString()}` : "Run catalog sync to import your Shopify products and collections."}</p>
          </article>
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
