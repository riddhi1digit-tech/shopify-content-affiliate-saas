import { randomUUID } from "node:crypto";

import type { LoaderFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopDomain = String(url.searchParams.get("shop") ?? "").toLowerCase();
  const code = String(url.searchParams.get("ref") ?? "");
  const sessionKey = String(url.searchParams.get("session") ?? "").slice(
    0,
    100,
  );
  const landingUrl = String(url.searchParams.get("landing") ?? "/").slice(
    0,
    2000,
  );
  const referrerUrl = String(url.searchParams.get("referrer") ?? "").slice(
    0,
    2000,
  );

  const store = await db.store.findUnique({ where: { shopDomain } });
  if (!store || !code) {
    return Response.json({ tracked: false }, { status: 404 });
  }

  const link = await db.affiliateLink.findFirst({
    where: {
      code,
      campaign: { organizationId: store.organizationId, status: "ACTIVE" },
      affiliate: { status: "ACTIVE" },
    },
  });
  if (!link) return Response.json({ tracked: false }, { status: 404 });

  const existing = sessionKey
    ? await db.affiliateClick.findFirst({
        where: { affiliateLinkId: link.id, sessionKey },
        select: { id: true },
      })
    : null;
  const click =
    existing ??
    (await db.affiliateClick.create({
      data: {
        id: randomUUID(),
        organizationId: store.organizationId,
        affiliateId: link.affiliateId,
        campaignId: link.campaignId,
        affiliateLinkId: link.id,
        sessionKey: sessionKey || null,
        landingUrl,
        referrerUrl: referrerUrl || null,
        userAgent: request.headers.get("user-agent"),
      },
      select: { id: true },
    }));

  console.info(
    `Affiliate click ${existing ? "reused" : "recorded"}: ${click.id}`,
  );

  return Response.json({
    tracked: true,
    clickId: click.id,
    attributionDays: 30,
    couponCode: link.couponCode,
  }, { headers: { "Cache-Control": "no-store" } });
};
