-- Invoice PDF feature (additive): an immutable invoice reference issued
-- lazily on the first invoice download for a PAID order. Existing rows stay
-- NULL — no backfill, no behaviour change for checkout/delivery flows.
-- Seller GST fields deliberately NOT added yet (owner registers the business
-- later; the GSTIN line renders from a SiteSetting when present).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "invoiceNumber" TEXT,
                     ADD COLUMN "invoiceIssuedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");
