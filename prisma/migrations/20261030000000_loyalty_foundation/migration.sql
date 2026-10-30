CREATE TABLE "LoyaltyProgram" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "pointsPerCurrency" DECIMAL(65,30) NOT NULL DEFAULT 1, "pointsName" TEXT NOT NULL DEFAULT 'Points',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyProgram_organizationId_key" ON "LoyaltyProgram"("organizationId");

CREATE TABLE "VipTier" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "threshold" INTEGER NOT NULL,
  "multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "VipTier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VipTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "VipTier_organizationId_name_key" ON "VipTier"("organizationId", "name");
CREATE INDEX "VipTier_organizationId_threshold_idx" ON "VipTier"("organizationId", "threshold");

CREATE TABLE "LoyaltyCustomer" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "storeId" TEXT NOT NULL, "shopifyCustomerId" TEXT NOT NULL,
  "email" TEXT, "pointsBalance" INTEGER NOT NULL DEFAULT 0, "lifetimePoints" INTEGER NOT NULL DEFAULT 0, "tierId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyCustomer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "LoyaltyCustomer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE,
  CONSTRAINT "LoyaltyCustomer_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "VipTier"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "LoyaltyCustomer_storeId_shopifyCustomerId_key" ON "LoyaltyCustomer"("storeId", "shopifyCustomerId");
CREATE INDEX "LoyaltyCustomer_organizationId_pointsBalance_idx" ON "LoyaltyCustomer"("organizationId", "pointsBalance");
CREATE INDEX "LoyaltyCustomer_tierId_idx" ON "LoyaltyCustomer"("tierId");

CREATE TABLE "LoyaltyTransaction" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "loyaltyCustomerId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "points" INTEGER NOT NULL, "shopifyOrderId" TEXT, "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "LoyaltyTransaction_loyaltyCustomerId_fkey" FOREIGN KEY ("loyaltyCustomerId") REFERENCES "LoyaltyCustomer"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyTransaction_loyaltyCustomerId_shopifyOrderId_type_key" ON "LoyaltyTransaction"("loyaltyCustomerId", "shopifyOrderId", "type");
CREATE INDEX "LoyaltyTransaction_organizationId_createdAt_idx" ON "LoyaltyTransaction"("organizationId", "createdAt");
