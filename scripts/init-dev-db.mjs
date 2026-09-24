import { DatabaseSync } from "node:sqlite";

const connection = process.env.DATABASE_URL;

if (!connection?.startsWith("file:")) {
  throw new Error("Local development requires a file: DATABASE_URL");
}

const databasePath = connection.slice("file:".length);
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT,
    "collaborator" INTEGER DEFAULT 0,
    "emailVerified" INTEGER DEFAULT 0,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
  );

  CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultCommission" DECIMAL NOT NULL DEFAULT 10,
    "attributionDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");

  CREATE TABLE IF NOT EXISTS "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyStoreId" TEXT,
    "name" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "lastSyncAt" DATETIME,
    CONSTRAINT "Store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Store_shopDomain_key" ON "Store"("shopDomain");
  CREATE INDEX IF NOT EXISTS "Store_organizationId_idx" ON "Store"("organizationId");

  CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "descriptionHtml" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Product_storeId_shopifyId_key" ON "Product"("storeId", "shopifyId");
  CREATE INDEX IF NOT EXISTS "Product_organizationId_storeId_idx" ON "Product"("organizationId", "storeId");

  CREATE TABLE IF NOT EXISTS "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Collection_storeId_shopifyId_key" ON "Collection"("storeId", "shopifyId");
  CREATE INDEX IF NOT EXISTS "Collection_organizationId_storeId_idx" ON "Collection"("organizationId", "storeId");

  CREATE TABLE IF NOT EXISTS "Content" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "approvedById" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "Content_organizationId_status_idx" ON "Content"("organizationId", "status");
  CREATE INDEX IF NOT EXISTS "Content_storeId_idx" ON "Content"("storeId");

  CREATE TABLE IF NOT EXISTS "ContentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "ContentVersion_contentId_version_key" ON "ContentVersion"("contentId", "version");

  CREATE TABLE IF NOT EXISTS "ContentTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "productId" TEXT,
    "collectionId" TEXT,
    "namespace" TEXT,
    "key" TEXT,
    CONSTRAINT "ContentTarget_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE,
    CONSTRAINT "ContentTarget_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE,
    CONSTRAINT "ContentTarget_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "ContentTarget_contentId_idx" ON "ContentTarget"("contentId");
  CREATE INDEX IF NOT EXISTS "ContentTarget_productId_idx" ON "ContentTarget"("productId");

  CREATE TABLE IF NOT EXISTS "Affiliate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "countryCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_organizationId_email_key" ON "Affiliate"("organizationId", "email");
  CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_organizationId_code_key" ON "Affiliate"("organizationId", "code");
  CREATE INDEX IF NOT EXISTS "Affiliate_organizationId_status_idx" ON "Affiliate"("organizationId", "status");

  CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "commissionType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "commissionValue" DECIMAL NOT NULL DEFAULT 10,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

  CREATE TABLE IF NOT EXISTS "AffiliateLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "affiliateId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "couponCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateLink_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE,
    CONSTRAINT "AffiliateLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateLink_code_key" ON "AffiliateLink"("code");
  CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateLink_affiliateId_campaignId_targetUrl_key" ON "AffiliateLink"("affiliateId", "campaignId", "targetUrl");
  CREATE INDEX IF NOT EXISTS "AffiliateLink_campaignId_idx" ON "AffiliateLink"("campaignId");

  CREATE TABLE IF NOT EXISTS "AffiliateClick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "affiliateLinkId" TEXT NOT NULL,
    "sessionKey" TEXT,
    "referrerUrl" TEXT,
    "landingUrl" TEXT NOT NULL,
    "countryCode" TEXT,
    "userAgent" TEXT,
    "clickedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateClick_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
    CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE,
    CONSTRAINT "AffiliateClick_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE,
    CONSTRAINT "AffiliateClick_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "AffiliateClick_organizationId_clickedAt_idx" ON "AffiliateClick"("organizationId", "clickedAt");
  CREATE INDEX IF NOT EXISTS "AffiliateClick_sessionKey_idx" ON "AffiliateClick"("sessionKey");

  CREATE TABLE IF NOT EXISTS "Conversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "campaignId" TEXT,
    "clickId" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "currencyCode" TEXT NOT NULL,
    "orderAmount" DECIMAL NOT NULL,
    "eligibleAmount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attributedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Conversion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
    CONSTRAINT "Conversion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE,
    CONSTRAINT "Conversion_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT,
    CONSTRAINT "Conversion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL,
    CONSTRAINT "Conversion_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Conversion_storeId_shopifyOrderId_key" ON "Conversion"("storeId", "shopifyOrderId");
  CREATE INDEX IF NOT EXISTS "Conversion_organizationId_status_idx" ON "Conversion"("organizationId", "status");
  CREATE INDEX IF NOT EXISTS "Conversion_affiliateId_attributedAt_idx" ON "Conversion"("affiliateId", "attributedAt");

  CREATE TABLE IF NOT EXISTS "Commission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "conversionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Commission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
    CONSTRAINT "Commission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT,
    CONSTRAINT "Commission_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS "Commission_organizationId_status_idx" ON "Commission"("organizationId", "status");
  CREATE INDEX IF NOT EXISTS "Commission_affiliateId_status_idx" ON "Commission"("affiliateId", "status");

  CREATE TABLE IF NOT EXISTS "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currencyCode" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "Payout_organizationId_status_idx" ON "Payout"("organizationId", "status");
  CREATE TABLE IF NOT EXISTS "PayoutItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutId" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "PayoutItem_commissionId_key" ON "PayoutItem"("commissionId");
  CREATE INDEX IF NOT EXISTS "PayoutItem_payoutId_idx" ON "PayoutItem"("payoutId");
`);

const productColumns = db.prepare('PRAGMA table_info("Product")').all();
if (!productColumns.some((column) => column.name === "descriptionHtml")) {
  db.exec('ALTER TABLE "Product" ADD COLUMN "descriptionHtml" TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS "AffiliateAccess" (
    "digest" TEXT PRIMARY KEY NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "AffiliateAccess_affiliateId_idx" ON "AffiliateAccess"("affiliateId");
  CREATE TABLE IF NOT EXISTS "AffiliateLoginLimit" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "windowStart" BIGINT NOT NULL,
    "count" INTEGER NOT NULL
  );
`);
db.close();
console.log(`Local development database ready: ${databasePath}`);
