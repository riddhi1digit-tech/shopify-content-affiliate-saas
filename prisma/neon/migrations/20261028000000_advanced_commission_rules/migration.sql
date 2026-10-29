CREATE TYPE "CommissionRuleScope" AS ENUM ('AFFILIATE', 'PRODUCT');

ALTER TABLE "Commission"
ADD COLUMN "ruleSource" TEXT NOT NULL DEFAULT 'CAMPAIGN',
ADD COLUMN "calculationDetails" JSONB;

CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "affiliateId" TEXT,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "scope" "CommissionRuleScope" NOT NULL,
    "type" "CommissionType" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionRule_organizationId_active_priority_idx" ON "CommissionRule"("organizationId", "active", "priority");
CREATE INDEX "CommissionRule_campaignId_active_priority_idx" ON "CommissionRule"("campaignId", "active", "priority");
CREATE INDEX "CommissionRule_affiliateId_active_priority_idx" ON "CommissionRule"("affiliateId", "active", "priority");
CREATE INDEX "CommissionRule_productId_active_priority_idx" ON "CommissionRule"("productId", "active", "priority");

ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
