import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";

import db from "../db.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";
import { createAffiliateInvite, privateHeaders } from "../models/affiliate-access.server";
import { emailConfiguration, sendAffiliateLoginEmail } from "../models/affiliate-email.server";

export const headers = privateHeaders;

const affiliateStatuses = [
  "PENDING",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
] as const;

type AffiliateStatus = (typeof affiliateStatuses)[number];
type ActionResult =
  { success: true; message: string; loginUrl?: string } | { success: false; error: string };

function normalizeCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isStatus(value: string): value is AffiliateStatus {
  return affiliateStatuses.includes(value as AffiliateStatus);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const affiliates = await db.affiliate.findMany({
    where: { organizationId: store.organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      code: true,
      status: true,
      countryCode: true,
      createdAt: true,
    },
  });

  return {
    affiliates,
    defaultCommission: Number(store.organization.defaultCommission),
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "invite" || intent === "emailInvite") {
    const affiliate = await db.affiliate.findFirst({ where: {
      id: String(form.get("affiliateId") ?? ""), organizationId: store.organizationId,
      status: { in: ["ACTIVE", "APPROVED"] },
    } });
    if (!affiliate) return { success: false, error: "Affiliate must be active or approved." };
    if (intent === "emailInvite") {
      try { emailConfiguration(); } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Email configuration is missing." };
      }
    }
    const token = await createAffiliateInvite({ affiliateId: affiliate.id, organizationId: store.organizationId, storeId: store.id });
    const origin = new URL(process.env.SHOPIFY_APP_URL || request.url).origin;
    if (intent === "emailInvite") {
      try {
        await sendAffiliateLoginEmail({ email: affiliate.email, name: affiliate.name, storeName: store.name ?? store.shopDomain, loginUrl: `${origin}/affiliate-login#token=${token}` });
        return { success: true, message: `Resend accepted the sign-in email for ${affiliate.email}. Check their inbox/spam folder. The link expires in 30 minutes and works once. Previous links and sessions were revoked.` };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Email failed. Previous links and sessions were revoked; generate another invitation to retry." };
      }
    }
    return { success: true, message: "Private login link created. Share only with this affiliate. Expires in 30 minutes; usable once. Previous links and sessions are revoked.", loginUrl: `${origin}/affiliate-login#token=${token}` };
  }

  if (intent === "status") {
    const affiliateId = String(form.get("affiliateId") ?? "");
    const status = String(form.get("status") ?? "");
    if (!isStatus(status)) {
      return { success: false, error: "Invalid affiliate status." };
    }
    const updated = await db.affiliate.updateMany({
      where: { id: affiliateId, organizationId: store.organizationId },
      data: { status },
    });
    return updated.count
      ? { success: true, message: "Affiliate status updated." }
      : { success: false, error: "Affiliate was not found." };
  }

  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const code = normalizeCode(String(form.get("code") ?? ""));
  const countryCode = String(form.get("countryCode") ?? "")
    .trim()
    .toUpperCase();
  const statusValue = String(form.get("status") ?? "PENDING");

  if (!name || !email || !code) {
    return {
      success: false,
      error: "Name, email, and referral code are required.",
    };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { success: false, error: "Enter a valid email address." };
  }
  if (!isStatus(statusValue)) {
    return { success: false, error: "Invalid affiliate status." };
  }

  const duplicate = await db.affiliate.findFirst({
    where: {
      organizationId: store.organizationId,
      OR: [{ email }, { code }],
    },
    select: { email: true, code: true },
  });
  if (duplicate) {
    return {
      success: false,
      error:
        duplicate.email === email
          ? "An affiliate with this email already exists."
          : "This referral code is already in use.",
    };
  }

  await db.affiliate.create({
    data: {
      organizationId: store.organizationId,
      name,
      email,
      code,
      status: statusValue,
      countryCode: countryCode || null,
    },
  });
  return { success: true, message: `Affiliate “${name}” created.` };
};

export default function AffiliatesPage() {
  const { affiliates, defaultCommission } = useLoaderData<typeof loader>();
  const manager = useFetcher<typeof action>();
  const busy = manager.state !== "idle";
  const activeCount = affiliates.filter((affiliate) => ["ACTIVE", "APPROVED"].includes(affiliate.status)).length;
  const pendingCount = affiliates.filter((affiliate) => affiliate.status === "PENDING").length;

  return (
    <s-page heading="Affiliates">
      <div className="merchant-affiliates">
        {manager.data?.success ? (
          <s-banner tone="success">{manager.data.message}</s-banner>
        ) : manager.data && !manager.data.success ? (
          <s-banner tone="critical">{manager.data.error}</s-banner>
        ) : null}
        {manager.data?.success && manager.data.loginUrl ? <div className="merchant-private-link">
          <div><strong>Private sign-in link created</strong><p>Keep this link private. Opening and signing in uses it once.</p></div>
          <a href={manager.data.loginUrl} target="_blank" rel="noreferrer">{manager.data.loginUrl}</a>
          <button className="merchant-button merchant-button--secondary" type="button" onClick={() => { if (manager.data?.success && manager.data.loginUrl) void navigator.clipboard.writeText(manager.data.loginUrl).then(() => window.alert("Private sign-in link copied."), () => window.alert("Select and copy the private link above.")); }}>Copy link</button>
        </div> : null}

        <section className="merchant-kpi-grid merchant-kpi-grid--compact" aria-label="Affiliate summary">
          <article className="merchant-kpi"><span>Total affiliates</span><strong>{affiliates.length}</strong><small>All program members</small></article>
          <article className="merchant-kpi"><span>Portal eligible</span><strong>{activeCount}</strong><small>Active or approved</small></article>
          <article className="merchant-kpi"><span>Pending review</span><strong>{pendingCount}</strong><small>Awaiting a decision</small></article>
          <article className="merchant-kpi"><span>Default commission</span><strong>{defaultCommission}%</strong><small>Workspace baseline</small></article>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">New partner</p><h3>Create affiliate</h3></div><p className="merchant-caption">Campaigns can override the {defaultCommission}% default rate.</p></div>
          <manager.Form method="post" className="merchant-form">
            <input type="hidden" name="intent" value="create" />
            <div className="merchant-form-grid merchant-form-grid--five">
              <label><span>Name</span><input name="name" placeholder="Jane Creator" required /></label>
              <label><span>Email</span><input name="email" type="email" placeholder="jane@example.com" required /></label>
              <label><span>Referral code</span><input name="code" placeholder="JANE10" required /></label>
              <label><span>Country</span><input name="countryCode" placeholder="IN" maxLength={2} /></label>
              <label><span>Status</span><select name="status" defaultValue="PENDING">{affiliateStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
            </div>
            <button className="merchant-button merchant-button--primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create affiliate"}</button>
          </manager.Form>
        </section>

        <section className="merchant-card">
          <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Directory</p><h3>Affiliate list</h3></div><span className="merchant-count">{affiliates.length}</span></div>
          {!affiliates.length ? <div className="merchant-empty">No affiliates created yet.</div> : <div className="merchant-affiliate-list">
            {affiliates.map((affiliate) => {
              const portalEligible = ["ACTIVE", "APPROVED"].includes(affiliate.status);
              return <article className="merchant-affiliate-card" key={affiliate.id}>
                <div className="merchant-affiliate-identity"><div className="merchant-avatar" aria-hidden="true">{affiliate.name.slice(0, 2).toUpperCase()}</div><div><div className="merchant-affiliate-name"><strong>{affiliate.name}</strong><span className={`merchant-status merchant-status--${affiliate.status.toLowerCase()}`}>{affiliate.status}</span></div><a href={`mailto:${affiliate.email}`}>{affiliate.email}</a></div></div>
                <div className="merchant-affiliate-meta"><span>Code <code>{affiliate.code}</code></span><span>Country <strong>{affiliate.countryCode ?? "—"}</strong></span></div>
                <div className="merchant-affiliate-actions">
                  <Link className="merchant-text-link" to={`/app/affiliate-dashboard?affiliateId=${encodeURIComponent(affiliate.id)}`}>View dashboard</Link>
                  <manager.Form method="post"><input type="hidden" name="intent" value="invite" /><input type="hidden" name="affiliateId" value={affiliate.id} /><button className="merchant-button merchant-button--secondary" type="submit" disabled={busy || !portalEligible}>Generate login link</button></manager.Form>
                  <manager.Form method="post"><input type="hidden" name="intent" value="emailInvite" /><input type="hidden" name="affiliateId" value={affiliate.id} /><button className="merchant-button merchant-button--secondary" type="submit" disabled={busy || !portalEligible}>Email login link</button></manager.Form>
                </div>
                <manager.Form method="post" className="merchant-status-form"><input type="hidden" name="intent" value="status" /><input type="hidden" name="affiliateId" value={affiliate.id} /><label><span>Account status</span><select name="status" defaultValue={affiliate.status}>{affiliateStatuses.map((status) => <option key={status}>{status}</option>)}</select></label><button className="merchant-button merchant-button--secondary" type="submit" disabled={busy}>Update</button></manager.Form>
              </article>;
            })}
          </div>}
        </section>
      </div>
    </s-page>
  );
}
