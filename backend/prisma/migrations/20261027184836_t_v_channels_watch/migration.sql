-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "deliveryMode" TEXT NOT NULL DEFAULT 'file',
ADD COLUMN     "fullVideoUrl" TEXT,
ADD COLUMN     "watchMaxConcurrent" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "watchTtlHours" INTEGER;

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'kids',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "handle" TEXT,
    "logo" TEXT,
    "description" VARCHAR(120),
    "audienceTag" TEXT,
    "buttonText" TEXT NOT NULL DEFAULT 'Subscribe',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchGrant" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockReason" TEXT,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 2,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchSession" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "networkHash" TEXT NOT NULL,
    "uaHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Channel_zone_enabled_sortOrder_idx" ON "Channel"("zone", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WatchGrant_orderId_key" ON "WatchGrant"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchGrant_tokenHash_key" ON "WatchGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "WatchGrant_orderId_idx" ON "WatchGrant"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchSession_sessionId_key" ON "WatchSession"("sessionId");

-- CreateIndex
CREATE INDEX "WatchSession_grantId_lastSeenAt_idx" ON "WatchSession"("grantId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "WatchSession_createdAt_idx" ON "WatchSession"("createdAt");

-- AddForeignKey
ALTER TABLE "WatchGrant" ADD CONSTRAINT "WatchGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSession" ADD CONSTRAINT "WatchSession_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "WatchGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
