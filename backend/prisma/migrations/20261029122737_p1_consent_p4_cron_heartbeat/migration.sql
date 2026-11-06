-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "consentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CronHeartbeat" (
    "key" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3) NOT NULL,
    "staleAlertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("key")
);
