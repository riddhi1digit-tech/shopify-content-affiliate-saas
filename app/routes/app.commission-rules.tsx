import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";

import db from "../db.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";

type ActionResult =
  | { success: true; message: string }
  | { success: false; error: string };

function optionalDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const [affiliates, products, campaigns, rules] = await Promise.all([
    db.affiliate.findMany({
      where: { organizationId: store.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.product.findMany({
      where: { storeId: store.id },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    db.campaign.findMany({
      where: { organizationId: store.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.commissionRule.findMany({
      where: { organizationId: store.organizationId },
      orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
      include: {
        affiliate: { select: { name: true } },
        product: { select: { title: true } },
        campaign: { select: { name: true } },
      },
    }),
  ]);

  return {
    affiliates,
    products,
    campaigns,
    rules: rules.map((rule) => ({
      ...rule,
      value: rule.value.toString(),
      startsAt: rule.startsAt?.toISOString() ?? null,
      endsAt: rule.endsAt?.toISOString() ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "toggle") {
    const id = String(form.get("id") ?? "");
    const rule = await db.commissionRule.findFirst({
      where: { id, organizationId: store.organizationId },
      select: { id: true, active: true },
    });
    if (!rule) return { success: false, error: "Commission rule not found." };
    await db.commissionRule.update({
      where: { id: rule.id },
      data: { active: !rule.active },
    });
    return {
      success: true,
      message: `Rule ${rule.active ? "paused" : "activated"}.`,
    };
  }

  const name = String(form.get("name") ?? "").trim();
  const scope = String(form.get("scope") ?? "AFFILIATE");
  const type = String(form.get("type") ?? "PERCENTAGE");
  const value = Number(form.get("value"));
  const priority = Number(form.get("priority") ?? 100);
  const affiliateId = String(form.get("affiliateId") ?? "");
  const productId = String(form.get("productId") ?? "");
  const campaignId = String(form.get("campaignId") ?? "");
  const startsAt = optionalDate(form.get("startsAt"));
  const endsAt = optionalDate(form.get("endsAt"));

  if (!name || name.length > 100) {
    return { success: false, error: "Enter a rule name up to 100 characters." };
  }
  if (scope !== "AFFILIATE" && scope !== "PRODUCT") {
    return { success: false, error: "Choose a valid rule scope." };
  }
  if (type !== "PERCENTAGE" && type !== "FIXED") {
    return { success: false, error: "Choose a valid commission type." };
  }
  if (!Number.isFinite(value) || value <= 0 || (type === "PERCENTAGE" && value > 100)) {
    return { success: false, error: "Enter a positive value; percentages cannot exceed 100%." };
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
    return { success: false, error: "Priority must be a whole number from 0 to 1000." };
  }
  if (startsAt === undefined || endsAt === undefined || (startsAt && endsAt && startsAt >= endsAt)) {
    return { success: false, error: "Enter a valid date range." };
  }

  const [affiliate, product, campaign] = await Promise.all([
    scope === "AFFILIATE"
      ? db.affiliate.findFirst({ where: { id: affiliateId, organizationId: store.organizationId }, select: { id: true } })
      : null,
    scope === "PRODUCT"
      ? db.product.findFirst({ where: { id: productId, storeId: store.id }, select: { id: true } })
      : null,
    campaignId
      ? db.campaign.findFirst({ where: { id: campaignId, organizationId: store.organizationId }, select: { id: true } })
      : null,
  ]);
  if (scope === "AFFILIATE" && !affiliate) {
    return { success: false, error: "Choose an affiliate from this workspace." };
  }
  if (scope === "PRODUCT" && !product) {
    return { success: false, error: "Choose a synchronized product." };
  }
  if (campaignId && !campaign) {
    return { success: false, error: "Choose a campaign from this workspace." };
  }

  await db.commissionRule.create({
    data: {
      organizationId: store.organizationId,
      name,
      scope,
      type,
      value,
      priority,
      startsAt,
      endsAt,
      affiliateId: affiliate?.id ?? null,
      productId: product?.id ?? null,
      campaignId: campaign?.id ?? null,
    },
  });

  return { success: true, message: `Commission rule “${name}” created.` };
};

export default function CommissionRulesPage() {
  const { affiliates, products, campaigns, rules } = useLoaderData<typeof loader>();
  const submitter = useFetcher<typeof action>();
  const busy = submitter.state !== "idle";

  return (
    <s-page heading="Commission rules">
      <div className="merchant-campaigns">
        {submitter.data?.success ? <s-banner tone="success">{submitter.data.message}</s-banner> : null}
        {submitter.data && !submitter.data.success ? <s-banner tone="critical">{submitter.data.error}</s-banner> : null}

        <section className="merchant-commission-notice">
          <span className="merchant-notice-icon">i</span>
          <div><strong>Deterministic rule priority</strong><p>Product rules override affiliate rules, and affiliate rules override the campaign rate. A higher priority wins when two rules target the same scope.</p></div>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Advanced earnings</p><h3>Create a commission rule</h3></div><p className="merchant-caption">Optionally limit a rule to one campaign or schedule it for a date range.</p></div>
          <submitter.Form method="post" className="merchant-form">
            <input type="hidden" name="intent" value="create" />
            <div className="merchant-form-grid merchant-rule-form-grid">
              <label><span>Rule name</span><input name="name" placeholder="VIP affiliate rate" maxLength={100} required /></label>
              <label><span>Scope</span><select name="scope" defaultValue="AFFILIATE"><option value="AFFILIATE">Affiliate</option><option value="PRODUCT">Product</option></select></label>
              <label><span>Affiliate target</span><select name="affiliateId" defaultValue=""><option value="">Select affiliate</option>{affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.id}>{affiliate.name} ({affiliate.code})</option>)}</select></label>
              <label><span>Product target</span><select name="productId" defaultValue=""><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}</select></label>
              <label><span>Campaign <em>Optional</em></span><select name="campaignId" defaultValue=""><option value="">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
              <label><span>Commission type</span><select name="type" defaultValue="PERCENTAGE"><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></label>
              <label><span>Value</span><input name="value" type="number" min="0.01" step="0.01" defaultValue="10" required /></label>
              <label><span>Priority</span><input name="priority" type="number" min="0" max="1000" step="1" defaultValue="100" required /></label>
              <label><span>Starts <em>Optional</em></span><input name="startsAt" type="datetime-local" /></label>
              <label><span>Ends <em>Optional</em></span><input name="endsAt" type="datetime-local" /></label>
            </div>
            <button className="merchant-button merchant-button--primary" disabled={busy} type="submit">{busy ? "Saving…" : "Create rule"}</button>
          </submitter.Form>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Rule engine</p><h3>Configured rules</h3></div><span className="merchant-count">{rules.length}</span></div>
          {rules.length === 0 ? <div className="merchant-empty">No advanced rules yet. Campaign rates remain active as the fallback.</div> : <div className="merchant-rule-list">{rules.map((rule) => {
            const target = rule.scope === "AFFILIATE" ? rule.affiliate?.name : rule.product?.title;
            return <article className="merchant-rule-card" key={rule.id}><div><div className="merchant-campaign-name"><h4>{rule.name}</h4><span className={`merchant-status merchant-status--${rule.active ? "active" : "suspended"}`}>{rule.active ? "ACTIVE" : "PAUSED"}</span></div><p>{rule.scope} · {target ?? "Missing target"}{rule.campaign ? ` · ${rule.campaign.name}` : " · All campaigns"}</p></div><div className="merchant-rule-value"><strong>{rule.type === "PERCENTAGE" ? `${Number(rule.value)}%` : Number(rule.value).toFixed(2)}</strong><span>Priority {rule.priority}</span></div><submitter.Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={rule.id} /><button className="merchant-button merchant-button--secondary" type="submit" disabled={busy}>{rule.active ? "Pause" : "Activate"}</button></submitter.Form></article>;
          })}</div>}
        </section>
      </div>
    </s-page>
  );
}
