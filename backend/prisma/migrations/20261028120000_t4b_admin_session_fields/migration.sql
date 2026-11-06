-- T4-b follow-up: restore the admin-auth columns that the 20261027 migration
-- rebaseline accidentally dropped while the code (admin-session.ts,
-- security-audit.ts, security-events route) kept using them. Additive only —
-- no existing column or row is touched. Matches the e98d0f6 ground-truth DDL
-- (nullable adminId + meta JSONB on AuditLog, deviceLabel + stepUpAt on
-- AdminSession; no FK on AuditLog.adminId so audit rows survive admin deletion).

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "adminId" TEXT,
                          ADD COLUMN "meta" JSONB;

-- AlterTable
ALTER TABLE "AdminSession" ADD COLUMN "deviceLabel" TEXT,
                           ADD COLUMN "stepUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");
