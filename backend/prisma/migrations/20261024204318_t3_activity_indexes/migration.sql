-- CreateIndex
CREATE INDEX "ActivityEvent_createdAt_id_idx" ON "ActivityEvent"("createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "ActivityEvent_productId_createdAt_idx" ON "ActivityEvent"("productId", "createdAt" DESC);
