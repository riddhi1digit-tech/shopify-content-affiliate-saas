import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";

import db from "../db.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";
import { PageIntro } from "../components/PageIntro";

type ActionResult = { message?: string; error?: string };

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const [affiliates, entries, cases] = await Promise.all([
    db.affiliate.findMany({
      where: { organizationId: store.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.blocklistEntry.findMany({
      where: { organizationId: store.organizationId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    }),
    db.conversion.findMany({
      where: {
        organizationId: store.organizationId,
        fraudEvents: { some: { status: "OPEN" } },
      },
      orderBy: { attributedAt: "desc" },
      include: {
        affiliate: { select: { name: true, code: true } },
        fraudEvents: { orderBy: { createdAt: "asc" } },
        commissions: { select: { id: true, status: true, amount: true, currencyCode: true } },
      },
      take: 100,
    }),
  ]);
  const affiliateNames = new Map(affiliates.map((affiliate) => [affiliate.id, affiliate.name]));

  return {
    affiliates,
    entries: entries.map((entry) => ({
      ...entry,
      displayValue: entry.kind === "AFFILIATE"
        ? affiliateNames.get(entry.targetValue) ?? "Unknown affiliate"
        : entry.targetValue,
      expiresAt: entry.expiresAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    })),
    cases: cases.map((item) => ({
      id: item.id,
      orderNumber: item.orderNumber ?? item.shopifyOrderId,
      affiliateName: item.affiliate.name,
      riskStatus: item.riskStatus,
      riskScore: item.riskScore,
      attributedAt: item.attributedAt.toISOString(),
      commission: item.commissions[0]
        ? {
            ...item.commissions[0],
            amount: item.commissions[0].amount.toString(),
          }
        : null,
      events: item.fraudEvents.map((event) => ({
        id: event.id,
        type: event.type,
        severity: event.severity,
        reason: event.reason,
        status: event.status,
      })),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "add_block") {
    const kind = String(form.get("kind") ?? "");
    const affiliateId = String(form.get("affiliateId") ?? "");
    const rawTarget = String(form.get("targetValue") ?? "").trim();
    const label = String(form.get("label") ?? "").trim().slice(0, 100);
    if (!(["AFFILIATE", "REFERRAL_CODE", "SESSION"] as string[]).includes(kind)) {
      return { error: "Choose a valid block type." };
    }
    let targetValue = rawTarget;
    if (kind === "AFFILIATE") {
      const affiliate = await db.affiliate.findFirst({
        where: { id: affiliateId, organizationId: store.organizationId },
        select: { id: true },
      });
      if (!affiliate) return { error: "Choose an affiliate from this workspace." };
      targetValue = affiliate.id;
    }
    if (!targetValue || targetValue.length > 200) {
      return { error: "Enter a target value up to 200 characters." };
    }
    await db.blocklistEntry.upsert({
      where: {
        organizationId_kind_targetValue: {
          organizationId: store.organizationId,
          kind: kind as "AFFILIATE" | "REFERRAL_CODE" | "SESSION",
          targetValue,
        },
      },
      update: { active: true, label: label || null },
      create: {
        organizationId: store.organizationId,
        kind: kind as "AFFILIATE" | "REFERRAL_CODE" | "SESSION",
        targetValue,
        label: label || null,
      },
    });
    return { message: "Blocklist entry saved." };
  }

  if (intent === "toggle_block") {
    const id = String(form.get("id") ?? "");
    const entry = await db.blocklistEntry.findFirst({
      where: { id, organizationId: store.organizationId },
      select: { id: true, active: true },
    });
    if (!entry) return { error: "Blocklist entry not found." };
    await db.blocklistEntry.update({ where: { id }, data: { active: !entry.active } });
    return { message: entry.active ? "Block disabled." : "Block activated." };
  }

  if (intent === "clear_case" || intent === "confirm_case") {
    const conversionId = String(form.get("conversionId") ?? "");
    const conversion = await db.conversion.findFirst({
      where: { id: conversionId, organizationId: store.organizationId },
      select: { id: true },
    });
    if (!conversion) return { error: "Risk case not found." };
    const clear = intent === "clear_case";
    await db.$transaction([
      db.conversion.update({
        where: { id: conversion.id },
        data: { riskStatus: clear ? "CLEAR" : "BLOCKED", riskScore: clear ? 0 : 100 },
      }),
      db.fraudEvent.updateMany({
        where: { conversionId: conversion.id, organizationId: store.organizationId },
        data: { status: clear ? "DISMISSED" : "RESOLVED", resolvedAt: new Date() },
      }),
      ...(clear
        ? [db.commission.updateMany({
            where: { conversionId: conversion.id, organizationId: store.organizationId, status: "HELD" },
            data: { status: "PENDING" },
          })]
        : []),
      db.auditLog.create({
        data: {
          organizationId: store.organizationId,
          action: clear ? "FRAUD_CASE_CLEARED" : "FRAUD_CASE_CONFIRMED",
          entityType: "Conversion",
          entityId: conversion.id,
        },
      }),
    ]);
    return { message: clear ? "Case cleared and commission released for review." : "Fraud case confirmed; commission remains held." };
  }

  return { error: "Invalid action." };
}

export default function FraudPage() {
  const { affiliates, entries, cases } = useLoaderData<typeof loader>();
  const manager = useFetcher<typeof action>();
  const busy = manager.state !== "idle";

  return <s-page heading="Fraud protection">
    <div className="merchant-commissions">
      <PageIntro icon="shield" eyebrow="Risk controls" title="Protect referral revenue" description="Review suspicious attribution, release legitimate commissions and block abusive referral traffic." />
      {manager.data?.error ? <s-banner tone="critical">{manager.data.error}</s-banner> : null}
      {manager.data?.message ? <s-banner tone="success">{manager.data.message}</s-banner> : null}

      <section className="merchant-kpi-grid merchant-kpi-grid--compact">
        <article className="merchant-kpi merchant-kpi--attention"><span>Open risk cases</span><strong>{cases.length}</strong><small>Commissions requiring review</small></article>
        <article className="merchant-kpi"><span>Active blocks</span><strong>{entries.filter((entry) => entry.active).length}</strong><small>Traffic denied before attribution</small></article>
      </section>

      <section className="merchant-card">
        <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Prevent abuse</p><h3>Add a blocklist entry</h3></div><p className="merchant-caption">Blocked traffic cannot activate referral tracking or coupons.</p></div>
        <manager.Form method="post" className="merchant-form">
          <input type="hidden" name="intent" value="add_block" />
          <div className="merchant-form-grid merchant-fraud-form-grid">
            <label><span>Block type</span><select name="kind" defaultValue="AFFILIATE"><option value="AFFILIATE">Affiliate</option><option value="REFERRAL_CODE">Referral code</option><option value="SESSION">Session key</option></select></label>
            <label><span>Affiliate target</span><select name="affiliateId" defaultValue=""><option value="">Select affiliate</option>{affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.id}>{affiliate.name} ({affiliate.code})</option>)}</select></label>
            <label><span>Referral/session target</span><input name="targetValue" maxLength={200} placeholder="Code or session key" /></label>
            <label><span>Reason label</span><input name="label" maxLength={100} placeholder="Repeated abuse" /></label>
          </div>
          <button className="merchant-button merchant-button--primary" type="submit" disabled={busy}>Add block</button>
        </manager.Form>
      </section>

      <section className="merchant-card">
        <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Review queue</p><h3>Suspicious commissions</h3></div><span className="merchant-count">{cases.length}</span></div>
        {cases.length === 0 ? <div className="merchant-empty">No suspicious commissions detected.</div> : <div className="merchant-fraud-list">{cases.map((item) => <article className="merchant-fraud-card" key={item.id}>
          <div className="merchant-commission-head"><div><div className="merchant-commission-title"><strong>{item.affiliateName}</strong><span className={`merchant-status merchant-status--${item.riskStatus.toLowerCase()}`}>{item.riskStatus}</span></div><p>Order #{item.orderNumber}</p></div><div className="merchant-risk-score"><span>Risk score</span><strong>{item.riskScore}/100</strong></div></div>
          <div className="merchant-fraud-signals">{item.events.map((event) => <div key={event.id}><strong>{event.type.replaceAll("_", " ")}</strong><span>{event.reason}</span></div>)}</div>
          {item.commission ? <p className="merchant-caption">Commission {item.commission.currencyCode} {Number(item.commission.amount).toFixed(2)} · {item.commission.status}</p> : null}
          <div className="merchant-fraud-actions"><manager.Form method="post"><input type="hidden" name="conversionId" value={item.id} /><button className="merchant-button merchant-button--primary" name="intent" value="clear_case" disabled={busy}>Mark legitimate</button></manager.Form><manager.Form method="post"><input type="hidden" name="conversionId" value={item.id} /><button className="merchant-button merchant-button--secondary" name="intent" value="confirm_case" disabled={busy}>Confirm fraud</button></manager.Form></div>
        </article>)}</div>}
      </section>

      <section className="merchant-card">
        <div className="merchant-card-heading"><div><p className="merchant-eyebrow">Controls</p><h3>Block list</h3></div><span className="merchant-count">{entries.length}</span></div>
        {entries.length === 0 ? <div className="merchant-empty">No blocklist entries.</div> : <div className="merchant-payout-list">{entries.map((entry) => <article className="merchant-payout-row" key={entry.id}><div><strong>{entry.displayValue}</strong><span>{entry.kind.replaceAll("_", " ")} · {entry.label ?? "No reason supplied"}</span></div><manager.Form method="post"><input type="hidden" name="intent" value="toggle_block" /><input type="hidden" name="id" value={entry.id} /><button className="merchant-button merchant-button--secondary" disabled={busy}>{entry.active ? "Disable" : "Activate"}</button></manager.Form></article>)}</div>}
      </section>
    </div>
  </s-page>;
}
