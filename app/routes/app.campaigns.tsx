import { randomUUID } from "node:crypto";

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";

import db from "../db.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";

type ActionResult =
  { success: true; message: string } | { success: false; error: string };

async function createShopifyDiscount(
  admin: AdminApiContext,
  title: string,
  code: string,
  percentage: number,
) {
  const response = await admin.graphql(
    `#graphql
      mutation CreateCampaignDiscount($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) {
          codeDiscountNode { id }
          userErrors { message }
        }
      }`,
    {
      variables: {
        input: {
          title: `${title} customer discount`,
          code,
          startsAt: new Date().toISOString(),
          context: { all: "ALL" },
          customerGets: {
            value: { percentage: percentage / 100 },
            items: { all: true },
          },
        },
      },
    },
  );
  const payload = (await response.json()) as {
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id: string };
        userErrors: Array<{ message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };
  const result = payload.data?.discountCodeBasicCreate;
  const errors = [
    ...(payload.errors?.map(({ message }) => message) ?? []),
    ...(result?.userErrors.map(({ message }) => message) ?? []),
  ];
  if (errors.length || !result?.codeDiscountNode) {
    throw new Error(
      errors.join("; ") || "Shopify did not create the discount.",
    );
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const [affiliates, products, campaigns] = await Promise.all([
    db.affiliate.findMany({
      where: {
        organizationId: store.organizationId,
        status: { in: ["APPROVED", "ACTIVE"] },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.product.findMany({
      where: { storeId: store.id },
      orderBy: { title: "asc" },
      select: { id: true, title: true, handle: true },
    }),
    db.campaign.findMany({
      where: { organizationId: store.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { clicks: true, conversions: true } },
        affiliateLinks: {
          include: { affiliate: { select: { name: true, code: true } } },
        },
      },
    }),
  ]);

  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return {
    shopDomain: store.shopDomain,
    affiliates,
    products,
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      commissionValue: campaign.commissionValue.toString(),
    })),
    themeEditorUrl: `https://${store.shopDomain}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/coupon-banner&target=newAppsSection`,
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const affiliateId = String(form.get("affiliateId") ?? "");
  const commissionType = String(form.get("commissionType") ?? "PERCENTAGE");
  const commissionValue = Number(form.get("commissionValue"));
  const destination = String(form.get("destination") ?? "/");
  const couponCode = String(form.get("couponCode") ?? "")
    .trim()
    .toUpperCase();
  const customerDiscount = Number(form.get("customerDiscount"));

  if (!name || !affiliateId) {
    return {
      success: false,
      error: "Campaign name and affiliate are required.",
    };
  }
  if (!Number.isFinite(commissionValue) || commissionValue <= 0) {
    return { success: false, error: "Commission must be greater than zero." };
  }
  if (commissionType !== "PERCENTAGE" && commissionType !== "FIXED") {
    return { success: false, error: "Invalid commission type." };
  }
  if (commissionType === "PERCENTAGE" && commissionValue > 100) {
    return {
      success: false,
      error: "Percentage commission cannot exceed 100%.",
    };
  }
  if (
    couponCode &&
    (!Number.isFinite(customerDiscount) ||
      customerDiscount <= 0 ||
      customerDiscount > 100)
  ) {
    return {
      success: false,
      error: "Customer discount must be between 0 and 100 percent.",
    };
  }

  const affiliate = await db.affiliate.findFirst({
    where: {
      id: affiliateId,
      organizationId: store.organizationId,
      status: { in: ["APPROVED", "ACTIVE"] },
    },
  });
  if (!affiliate) {
    return { success: false, error: "Choose an approved or active affiliate." };
  }

  const allowedPaths = new Set([
    "/",
    ...(
      await db.product.findMany({
        where: { storeId: store.id, handle: { not: null } },
        select: { handle: true },
      })
    ).map(({ handle }) => `/products/${handle}`),
  ]);
  if (!allowedPaths.has(destination)) {
    return { success: false, error: "Invalid Shopify destination." };
  }

  const targetUrl = `https://${store.shopDomain}${destination}`;
  const trackingCode = `${affiliate.code}-${randomUUID().slice(0, 8)}`;

  if (couponCode) {
    try {
      await createShopifyDiscount(admin, name, couponCode, customerDiscount);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Discount creation failed.",
      };
    }
  }

  await db.campaign.create({
    data: {
      organizationId: store.organizationId,
      name,
      status: "ACTIVE",
      commissionType,
      commissionValue,
      affiliateLinks: {
        create: {
          affiliateId: affiliate.id,
          code: trackingCode,
          targetUrl,
          couponCode: couponCode || null,
        },
      },
    },
  });

  return { success: true, message: `Campaign “${name}” created.` };
};

function trackingUrl(
  targetUrl: string,
  code: string,
  couponCode: string | null,
) {
  const url = new URL(targetUrl);
  const destination = `${url.pathname}?ref=${encodeURIComponent(code)}${
    couponCode ? `&coupon=${encodeURIComponent(couponCode)}` : ""
  }`;
  if (!couponCode) return `${url.origin}${destination}`;
  return `${url.origin}/discount/${encodeURIComponent(couponCode)}?redirect=${encodeURIComponent(destination)}`;
}

export default function CampaignsPage() {
  const { affiliates, products, campaigns, themeEditorUrl } =
    useLoaderData<typeof loader>();
  const creator = useFetcher<typeof action>();
  const busy = creator.state !== "idle";
  const totalClicks = campaigns.reduce((sum, campaign) => sum + campaign._count.clicks, 0);
  const totalConversions = campaigns.reduce((sum, campaign) => sum + campaign._count.conversions, 0);
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "ACTIVE").length;

  return (
    <s-page heading="Campaigns">
      <div className="merchant-campaigns">
        {creator.data?.success ? (
          <s-banner tone="success">{creator.data.message}</s-banner>
        ) : creator.data && !creator.data.success ? (
          <s-banner tone="critical">{creator.data.error}</s-banner>
        ) : null}

        <section className="merchant-kpi-grid merchant-kpi-grid--compact" aria-label="Campaign summary">
          <article className="merchant-kpi"><span>Total campaigns</span><strong>{campaigns.length}</strong><small>All campaign records</small></article>
          <article className="merchant-kpi"><span>Active</span><strong>{activeCampaigns}</strong><small>Currently accepting traffic</small></article>
          <article className="merchant-kpi"><span>Tracked visits</span><strong>{totalClicks}</strong><small>Across campaign links</small></article>
          <article className="merchant-kpi"><span>Conversions</span><strong>{totalConversions}</strong><small>Attributed orders</small></article>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">New promotion</p><h3>Create campaign and tracking link</h3></div><p className="merchant-caption">Assign an affiliate, commission, destination, and optional customer discount.</p></div>
        {affiliates.length === 0 ? (
          <s-banner tone="warning">
            Create an affiliate and set their status to APPROVED or ACTIVE
            first.
          </s-banner>
        ) : (
          <creator.Form method="post" className="merchant-form">
            <div className="merchant-form-grid merchant-campaign-form-grid">
              <label><span>Campaign name</span><input name="name" placeholder="September promotion" required /></label>
              <label><span>Affiliate</span><select name="affiliateId" required>
                  {affiliates.map((affiliate) => (
                    <option key={affiliate.id} value={affiliate.id}>
                      {affiliate.name} ({affiliate.code})
                    </option>
                  ))}
                </select></label>
              <label><span>Commission type</span><select name="commissionType" defaultValue="PERCENTAGE">
                  <option value="PERCENTAGE">Percentage</option>
                  <option value="FIXED">Fixed amount</option>
                </select></label>
              <label><span>Commission value</span><input name="commissionValue" type="number" min="0.01" step="0.01" defaultValue="10" required /></label>
              <label><span>Destination</span><select name="destination" defaultValue="/">
                  <option value="/">Store homepage</option>
                  {products
                    .filter(({ handle }) => handle)
                    .map((product) => (
                      <option
                        key={product.id}
                        value={`/products/${product.handle}`}
                      >
                        {product.title}
                      </option>
                    ))}
                </select></label>
              <label><span>Coupon code <em>Optional</em></span><input name="couponCode" placeholder="SAVE10" /></label>
              <label><span>Customer discount %</span><input name="customerDiscount" type="number" min="0.01" max="100" step="0.01" defaultValue="10" /></label>
            </div>
            <button className="merchant-button merchant-button--primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create campaign"}</button>
          </creator.Form>
        )}
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Performance</p><h3>Campaign directory</h3></div><span className="merchant-count">{campaigns.length}</span></div>
        {campaigns.length === 0 ? (
          <div className="merchant-empty">No campaigns created yet.</div>
        ) : (
          <div className="merchant-campaign-list">
            {campaigns.map((campaign) => (
              <article className="merchant-campaign-card" key={campaign.id}>
                <div className="merchant-campaign-header"><div><div className="merchant-campaign-name"><h4>{campaign.name}</h4><span className={`merchant-status merchant-status--${campaign.status.toLowerCase()}`}>{campaign.status}</span></div><p>{campaign.commissionType === "PERCENTAGE" ? `${Number(campaign.commissionValue)}% commission` : `${Number(campaign.commissionValue)} fixed commission`}</p></div><div className="merchant-campaign-metrics"><span><strong>{campaign._count.clicks}</strong> visits</span><span><strong>{campaign._count.conversions}</strong> conversions</span></div></div>
                <div className="merchant-campaign-links">
                  {campaign.affiliateLinks.map((link) => {
                    const url = trackingUrl(link.targetUrl, link.code, link.couponCode);
                    return <div className="merchant-tracking-link" key={link.id}><div><strong>{link.affiliate.name}</strong>{link.couponCode ? <span>Coupon <code>{link.couponCode}</code></span> : <span>No coupon</span>}</div><a href={url} target="_blank" rel="noreferrer">{url}</a><button className="merchant-button merchant-button--secondary" type="button" onClick={() => { void navigator.clipboard.writeText(url).then(() => window.alert("Campaign link copied."), () => window.alert("Select and copy the link above.")); }}>Copy link</button></div>;
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
        </section>

        <section className="merchant-theme-callout"><div><p className="merchant-eyebrow">Storefront setup</p><h3>Show coupons on your theme</h3><p>Add the Coupon banner app block. Campaign links pass the correct code and apply it through Shopify automatically.</p></div><a className="merchant-button merchant-button--primary" href={themeEditorUrl} target="_top">Open theme editor</a></section>
      </div>
    </s-page>
  );
}
