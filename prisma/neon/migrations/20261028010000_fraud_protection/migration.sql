ALTER TYPE "CommissionStatus" ADD VALUE 'HELD' AFTER 'PENDING';

CREATE TYPE "FraudEventType" AS ENUM ('BLOCKLIST_MATCH', 'MISSING_SESSION', 'CLICK_NOT_FOUND', 'CLICK_EXPIRED', 'REFERRAL_SWITCH', 'SESSION_VELOCITY');
CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "FraudReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ConversionRiskStatus" AS ENUM ('CLEAR', 'REVIEW', 'BLOCKED');
CREATE TYPE "BlocklistKind" AS ENUM ('AFFILIATE', 'REFERRAL_CODE', 'SESSION');

ALTER TABLE "Conversion"
ADD COLUMN "riskStatus" "ConversionRiskStatus" NOT NULL DEFAULT 'CLEAR',
ADD COLUMN "riskScore" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "FraudEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "affiliateId" TEXT,
  "clickId" TEXT,
  "conversionId" TEXT,
  "type" "FraudEventType" NOT NULL,
  "severity" "FraudSeverity" NOT NULL,
  "score" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB,
  "status" "FraudReviewStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "FraudEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlocklistEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" "BlocklistKind" NOT NULL,
  "targetValue" TEXT NOT NULL,
  "label" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlocklistEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FraudEvent_organizationId_status_createdAt_idx" ON "FraudEvent"("organizationId", "status", "createdAt");
CREATE INDEX "FraudEvent_affiliateId_createdAt_idx" ON "FraudEvent"("affiliateId", "createdAt");
CREATE INDEX "FraudEvent_conversionId_idx" ON "FraudEvent"("conversionId");
CREATE UNIQUE INDEX "BlocklistEntry_organizationId_kind_targetValue_key" ON "BlocklistEntry"("organizationId", "kind", "targetValue");
CREATE INDEX "BlocklistEntry_organizationId_active_kind_idx" ON "BlocklistEntry"("organizationId", "active", "kind");

ALTER TABLE "FraudEvent" ADD CONSTRAINT "FraudEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FraudEvent" ADD CONSTRAINT "FraudEvent_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudEvent" ADD CONSTRAINT "FraudEvent_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FraudEvent" ADD CONSTRAINT "FraudEvent_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlocklistEntry" ADD CONSTRAINT "BlocklistEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
