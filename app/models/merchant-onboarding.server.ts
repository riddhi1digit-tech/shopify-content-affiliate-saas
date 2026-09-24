import { createHash } from "node:crypto";

import db from "../db.server";

function merchantNameFromDomain(shopDomain: string) {
  const handle = shopDomain.replace(/\.myshopify\.com$/i, "");

  return handle
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function organizationSlug(shopDomain: string) {
  const handle = shopDomain
    .replace(/\.myshopify\.com$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = createHash("sha256").update(shopDomain).digest("hex").slice(0, 8);

  return `${handle || "merchant"}-${suffix}`;
}

/** Idempotently connects an authenticated Shopify domain to one tenant. */
export async function provisionMerchant(shopDomain: string) {
  const normalizedDomain = shopDomain.trim().toLowerCase();
  const existingStore = await db.store.findUnique({
    where: { shopDomain: normalizedDomain },
    include: { organization: true },
  });

  if (existingStore) {
    return db.store.update({
      where: { id: existingStore.id },
      data: { status: "ACTIVE", uninstalledAt: null },
      include: { organization: true },
    });
  }

  return db.$transaction(async (tx) => {
    const displayName = merchantNameFromDomain(normalizedDomain) || normalizedDomain;
    const slug = organizationSlug(normalizedDomain);
    const organization = await tx.organization.upsert({
      where: { slug },
      update: { name: displayName },
      create: {
        name: displayName,
        slug,
      },
    });

    return tx.store.upsert({
      where: { shopDomain: normalizedDomain },
      update: {
        status: "ACTIVE",
        uninstalledAt: null,
      },
      create: {
        organizationId: organization.id,
        shopDomain: normalizedDomain,
        name: displayName,
      },
      include: { organization: true },
    });
  });
}

export async function markMerchantUninstalled(shopDomain: string) {
  const normalizedDomain = shopDomain.trim().toLowerCase();

  return db.$transaction([
    db.store.updateMany({
      where: { shopDomain: normalizedDomain },
      data: { status: "UNINSTALLED", uninstalledAt: new Date() },
    }),
    db.session.deleteMany({ where: { shop: normalizedDomain } }),
  ]);
}
