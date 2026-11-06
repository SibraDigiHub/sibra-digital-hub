-- Payment dual-gateway + delivery infrastructure (audit fix).
--
-- The schema carried these objects but the migration history did not:
-- a fresh `prisma migrate deploy` produced a database where the checkout
-- code failed with P2022 (column/table does not exist). This migration
-- restores parity between prisma/schema.prisma and the migration chain.
--
-- Every statement is IDEMPOTENT (IF NOT EXISTS / existence-guarded DO
-- blocks) so it is safe both on a fresh database and on any database
-- that was synced out-of-band via `prisma db push` — existing rows keep
-- working: `amountMinor` stays NULL for legacy orders (handled by
-- orderExpectedPaise) and the new NOT NULL columns carry defaults.

-- ── Order: dual-gateway snapshot columns ─────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "amountMinor" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "billingCountry" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "gateway" TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ipCountry" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paypalCaptureId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paypalOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── WebhookEvent: per-gateway event identity ─────────────────
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "gateway" TEXT NOT NULL DEFAULT 'razorpay';

-- ── PaymentAttempt (gateway call audit trail) ────────────────
CREATE TABLE IF NOT EXISTS "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- ── IdempotencyKey (checkout create replay) ──────────────────
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- ── EmailOutbox (exactly-once delivery email queue) ──────────
CREATE TABLE IF NOT EXISTS "EmailOutbox" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "PaymentAttempt_orderId_createdAt_idx" ON "PaymentAttempt"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_gateway_status_idx" ON "PaymentAttempt"("gateway", "status");
CREATE INDEX IF NOT EXISTS "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");
CREATE INDEX IF NOT EXISTS "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailOutbox_orderId_template_key" ON "EmailOutbox"("orderId", "template");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_paypalOrderId_key" ON "Order"("paypalOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_paypalCaptureId_key" ON "Order"("paypalCaptureId");
CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_gateway_status_createdAt_idx" ON "Order"("gateway", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_gateway_eventId_key" ON "WebhookEvent"("gateway", "eventId");

-- ── Foreign keys (existence-guarded: re-running must not fail) ──
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAttempt_orderId_fkey'
    ) THEN
        ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EmailOutbox_orderId_fkey'
    ) THEN
        ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
