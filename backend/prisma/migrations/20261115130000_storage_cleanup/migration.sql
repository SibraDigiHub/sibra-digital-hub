-- Additive storage-cleanup schema (refcounted deletes for ImageKit + R2).
-- Safe on any database state: IF NOT EXISTS everywhere, no data touched.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "mediaRefs" TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "StorageCleanup" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fileRef" TEXT NOT NULL,
    "fileId" TEXT,
    "reason" TEXT NOT NULL,
    "entityId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StorageCleanup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StorageCleanup_provider_fileRef_key" ON "StorageCleanup"("provider", "fileRef");
CREATE INDEX IF NOT EXISTS "StorageCleanup_status_nextAttemptAt_idx" ON "StorageCleanup"("status", "nextAttemptAt");
