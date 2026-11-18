-- Additive Razorpay Orders API migration (single-gateway migration plan §2.2).
-- Legacy columns (razorpayPaymentLinkId, paypalOrderId, paypalCaptureId) stay:
-- historical rows remain readable in admin. No drops, no rewrites.
-- IF NOT EXISTS keeps the migration idempotent on databases that already
-- carry some of these columns from an interrupted earlier apply.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "razorpayOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentInternational" BOOLEAN;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_razorpayOrderId_key" ON "Order"("razorpayOrderId");
