import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import { AppIcon } from "../components/AppIcon";
import { PageIntro } from "../components/PageIntro";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const program = await db.loyaltyProgram.upsert({ where: { organizationId: store.organizationId }, update: {}, create: { organizationId: store.organizationId } });
  const [tiers, customers, transactions] = await Promise.all([
    db.vipTier.findMany({ where: { organizationId: store.organizationId }, orderBy: { threshold: "asc" } }),
    db.loyaltyCustomer.findMany({ where: { organizationId: store.organizationId }, include: { tier: true }, orderBy: { pointsBalance: "desc" }, take: 20 }),
    db.loyaltyTransaction.findMany({ where: { organizationId: store.organizationId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { program: { active: program.active, pointsName: program.pointsName, pointsPerCurrency: Number(program.pointsPerCurrency) }, tiers: tiers.map((tier) => ({ ...tier, multiplier: Number(tier.multiplier) })), customers: customers.map((customer) => ({ id: customer.id, customerId: customer.shopifyCustomerId, email: customer.email, balance: customer.pointsBalance, lifetime: customer.lifetimePoints, tier: customer.tier?.name ?? "Member" })), transactionCount: transactions.length };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "settings") {
      const pointsName = String(form.get("pointsName") ?? "Points").trim() || "Points";
      const pointsPerCurrency = Number(form.get("pointsPerCurrency"));
      if (!Number.isFinite(pointsPerCurrency) || pointsPerCurrency <= 0 || pointsPerCurrency > 1000) throw new Error("Enter an earning rate between 0 and 1,000.");
      const active = form.get("active") === "on";
      await db.loyaltyProgram.upsert({ where: { organizationId: store.organizationId }, update: { active, pointsName, pointsPerCurrency }, create: { organizationId: store.organizationId, active, pointsName, pointsPerCurrency } });
      return { success: "Loyalty settings saved." };
    }
    if (intent === "tier") {
      const name = String(form.get("name") ?? "").trim(); const threshold = Number(form.get("threshold")); const multiplier = Number(form.get("multiplier"));
      if (!name || !Number.isInteger(threshold) || threshold < 0 || !Number.isFinite(multiplier) || multiplier < 1) throw new Error("Enter a tier name, whole-number threshold, and multiplier of 1 or more.");
      await db.vipTier.create({ data: { organizationId: store.organizationId, name, threshold, multiplier } });
      return { success: "VIP tier created." };
    }
    if (intent === "delete-tier") { await db.vipTier.deleteMany({ where: { id: String(form.get("tierId") ?? ""), organizationId: store.organizationId } }); return { success: "VIP tier removed." }; }
    return { error: "Unknown loyalty action." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not update loyalty settings." }; }
}

export default function LoyaltyPage() {
  const data = useLoaderData<typeof loader>(); const result = useActionData<typeof action>();
  const outstanding = data.customers.reduce((sum, customer) => sum + customer.balance, 0);
  return <main className="merchant-dashboard">
    <PageIntro eyebrow="Retention" title="Loyalty & VIP rewards" description="Reward repeat customers with purchase points and flexible VIP earning multipliers. Every balance change is recorded in an auditable ledger." icon="loyalty" />
    {result?.error ? <div className="merchant-alert merchant-alert--error">{result.error}</div> : null}{result?.success ? <div className="merchant-alert merchant-alert--success">{result.success}</div> : null}
    <section className="merchant-kpi-grid merchant-kpi-grid--compact"><article className="merchant-kpi"><span>Members</span><strong>{data.customers.length}</strong><small>Loyalty customers</small></article><article className="merchant-kpi"><span>Outstanding</span><strong>{outstanding}</strong><small>{data.program.pointsName} available</small></article><article className="merchant-kpi"><span>VIP tiers</span><strong>{data.tiers.length}</strong><small>Levels configured</small></article><article className="merchant-kpi"><span>Ledger events</span><strong>{data.transactionCount}</strong><small>Latest balance changes</small></article></section>
    <div className="merchant-content-grid">
      <section className="merchant-card"><div className="merchant-card-heading"><div><p className="merchant-eyebrow">Program</p><h3>Earning settings</h3></div><AppIcon name="loyalty" /></div><Form method="post" className="merchant-form"><input type="hidden" name="intent" value="settings"/><label className="merchant-check"><input defaultChecked={data.program.active} name="active" type="checkbox"/> Program active</label><label>Points name<input defaultValue={data.program.pointsName} name="pointsName" required/></label><label>Points per currency unit<input defaultValue={data.program.pointsPerCurrency} min="0.01" name="pointsPerCurrency" step="0.01" type="number" required/></label><button className="merchant-button" type="submit">Save program</button></Form></section>
      <section className="merchant-card"><p className="merchant-eyebrow">VIP</p><h3>Reward your best customers</h3><Form method="post" className="merchant-form"><input type="hidden" name="intent" value="tier"/><label>Tier name<input name="name" placeholder="Gold" required/></label><label>Lifetime points required<input min="0" name="threshold" type="number" required/></label><label>Earning multiplier<input defaultValue="1" min="1" name="multiplier" step="0.1" type="number" required/></label><button className="merchant-button" type="submit">Add VIP tier</button></Form><div className="loyalty-tier-list">{data.tiers.map((tier) => <div key={tier.id}><span><strong>{tier.name}</strong><small>{tier.threshold}+ points · {tier.multiplier}× earning</small></span><Form method="post"><input type="hidden" name="intent" value="delete-tier"/><input type="hidden" name="tierId" value={tier.id}/><button className="merchant-button merchant-button--ghost" type="submit">Remove</button></Form></div>)}</div></section>
    </div>
    <section className="merchant-card"><div className="merchant-card-heading"><div><p className="merchant-eyebrow">Members</p><h3>Customer balances</h3></div><span className="merchant-count">{data.customers.length}</span></div>{data.customers.length ? <div className="merchant-table"><div className="merchant-table-row merchant-table-head"><span>Customer</span><span>Tier</span><span>Balance</span><span>Lifetime</span></div>{data.customers.map((customer) => <div className="merchant-table-row" key={customer.id}><span>{customer.email ?? `Customer ${customer.customerId}`}</span><span>{customer.tier}</span><strong>{customer.balance}</strong><span>{customer.lifetime}</span></div>)}</div> : <div className="merchant-empty"><AppIcon name="loyalty" size={26}/><strong>No loyalty members yet</strong><span>Customers appear here after their first qualifying order.</span></div>}</section>
  </main>;
}
