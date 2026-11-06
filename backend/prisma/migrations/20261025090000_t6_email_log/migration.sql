-- EmailLog (T6 §7.2): one row per email send attempt (ok or error).
-- Recipients stored ONLY as a sha256 hash (toHash) + masked form
-- (toMasked) — never the raw address.
-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "toHash" TEXT,
    "toMasked" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT,
    "orderId" TEXT,
    "provider" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "attempt" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_orderId_idx" ON "EmailLog"("orderId");

-- CreateIndex
CREATE INDEX "EmailLog_toHash_idx" ON "EmailLog"("toHash");
