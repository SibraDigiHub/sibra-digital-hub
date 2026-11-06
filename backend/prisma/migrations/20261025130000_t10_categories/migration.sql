-- T10 — dynamic, admin-managed product categories.
-- Product.category stays a plain indexed string; this table is the
-- registry the storefront and admin panel read. Built-in defaults
-- are seeded by prisma/seed.ts so behaviour is unchanged.

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'kids',
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📦',
    "blurb" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_zone_sortOrder_idx" ON "Category"("zone", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_active_idx" ON "Category"("active");
