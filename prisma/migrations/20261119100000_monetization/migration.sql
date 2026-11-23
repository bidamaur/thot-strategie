-- Monétisation (paiements Mobile Money manuels, dons, intérêts Premium) et
-- disponibilités hebdomadaires : migration additive, aucune donnée modifiée.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "verifiedCountryCode" VARCHAR(2);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" VARCHAR(12) NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "tierLevel" INTEGER,
    "tierName" VARCHAR(60),
    "durationDays" INTEGER,
    "expectedAmount" INTEGER NOT NULL,
    "declaredAmount" INTEGER NOT NULL,
    "receivedAmount" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'XAF',
    "senderPhone" VARCHAR(20) NOT NULL,
    "recipientPhone" VARCHAR(20) NOT NULL,
    "transactionRef" VARCHAR(60) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "proofImage" VARCHAR(300),
    "country" VARCHAR(80),
    "countryCode" VARCHAR(2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" VARCHAR(40),
    "rejectNote" VARCHAR(300),
    "premiumStartsAt" TIMESTAMP(3),
    "premiumExpiresAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE INDEX "Payment_purpose_status_createdAt_idx" ON "Payment"("purpose", "status", "createdAt");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_provider_transactionRef_idx" ON "Payment"("provider", "transactionRef");

-- Sécurité (index partiels, garantis par la base) :
-- une référence de transaction ne peut être validée qu'une seule fois par opérateur…
CREATE UNIQUE INDEX "Payment_validated_ref_key" ON "Payment"("provider", "transactionRef") WHERE "status" = 'VALIDATED';
-- …et ne peut pas être en attente dans deux déclarations à la fois.
CREATE UNIQUE INDEX "Payment_pending_ref_key" ON "Payment"("provider", "transactionRef") WHERE "status" = 'PENDING';
-- Une seule déclaration en attente par joueur et par objet (Premium / don).
CREATE UNIQUE INDEX "Payment_pending_user_key" ON "Payment"("userId", "purpose") WHERE "status" = 'PENDING';

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PremiumInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" VARCHAR(40) NOT NULL,
    "tierLevel" INTEGER NOT NULL DEFAULT 0,
    "country" VARCHAR(80),
    "countryCode" VARCHAR(2),
    "views" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waitlist" BOOLEAN NOT NULL DEFAULT false,
    "waitlistAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "PremiumInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PremiumInterest_userId_feature_tierLevel_key" ON "PremiumInterest"("userId", "feature", "tierLevel");
CREATE INDEX "PremiumInterest_feature_idx" ON "PremiumInterest"("feature");
CREATE INDEX "PremiumInterest_waitlist_notifiedAt_idx" ON "PremiumInterest"("waitlist", "notifiedAt");
CREATE INDEX "PremiumInterest_firstAt_idx" ON "PremiumInterest"("firstAt");

ALTER TABLE "PremiumInterest" ADD CONSTRAINT "PremiumInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PlayerAvailability" (
    "userId" TEXT NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "weekly" JSONB NOT NULL DEFAULT '{}',
    "overrideFrom" DATE,
    "overrideTo" DATE,
    "overrideWeekly" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAvailability_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "PlayerAvailability" ADD CONSTRAINT "PlayerAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
