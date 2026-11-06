// T10 — Business rules for dynamic, admin-managed categories.
// The storefront ships hardcoded defaults as a fallback, but every
// category the admin creates lives here and is served through
// /api/categories (public) and /api/admin/categories (full control).
// Product.category remains a plain string — the slug is the join key,
// so new categories work with existing filters/search with zero
// changes to the catalog engine.
import { badRequest, conflict, notFound } from '@/lib/api'
import { slugify } from '@/services/product-service'
import { categoryRepo, type CategoryRow } from '@/repositories/category-repo'
import type { CategoryCreateInput, CategoryUpdateInput } from '@/validators/category'

/** Public shape — what the storefront chips/forms/labels need. */
export interface PublicCategory {
  id: string
  zone: string
  slug: string
  label: string
  emoji: string
  blurb: string
  sortOrder: number
}

/** Admin shape — adds visibility flag + how many products use it. */
export interface AdminCategory extends PublicCategory {
  active: boolean
  productCount: number
  createdAt: Date
  updatedAt: Date
}

export function toPublicCategory(c: CategoryRow): PublicCategory {
  return {
    id: c.id,
    zone: c.zone,
    slug: c.slug,
    label: c.label,
    emoji: c.emoji,
    blurb: c.blurb,
    sortOrder: c.sortOrder,
  }
}

export async function listPublicCategories(zone?: string): Promise<PublicCategory[]> {
  const rows = await categoryRepo.listActive(zone)
  return rows.map(toPublicCategory)
}

export async function adminListCategories(zone?: string): Promise<AdminCategory[]> {
  const rows = zone ? (await categoryRepo.listAll()).filter((c) => c.zone === zone) : await categoryRepo.listAll()
  const counts = await categoryRepo.countProductsBySlugs(rows.map((c) => c.slug))
  return rows.map((c) => ({
    ...toPublicCategory(c),
    active: c.active,
    productCount: counts[c.slug] ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }))
}

export async function createCategory(input: CategoryCreateInput): Promise<CategoryRow> {
  const label = input.label
  const slug = input.slug && input.slug.length > 0 ? input.slug : slugify(label)

  if (!slug || slug.length < 2) throw badRequest('Category slug must be at least 2 characters')
  if (slug.length > 40) throw badRequest('Category slug must be 40 characters or fewer')

  const existing = await categoryRepo.bySlug(slug)
  if (existing) throw conflict(`Category slug "${slug}" already exists — pick another`)

  const sortOrder = input.sortOrder ?? (await categoryRepo.nextSortOrder(input.zone))
  return categoryRepo.create({
    zone: input.zone,
    slug,
    label,
    emoji: input.emoji,
    blurb: input.blurb,
    sortOrder,
  })
}

export async function updateCategory(id: string, input: CategoryUpdateInput): Promise<CategoryRow> {
  const before = await categoryRepo.byId(id)
  if (!before) throw notFound('Category not found')

  // slug + zone are immutable — renaming either would orphan the
  // products pointing at the old slug. Create a new category instead.
  if ('slug' in input || 'zone' in input) {
    throw badRequest('Category slug and zone cannot be changed — create a new category instead')
  }

  const data: Partial<CategoryUpdateInput> = {}
  if (input.label !== undefined && input.label !== before.label) data.label = input.label
  if (input.emoji !== undefined && input.emoji !== before.emoji) data.emoji = input.emoji
  if (input.blurb !== undefined && input.blurb !== before.blurb) data.blurb = input.blurb
  if (input.sortOrder !== undefined && input.sortOrder !== before.sortOrder) data.sortOrder = input.sortOrder
  if (input.active !== undefined && input.active !== before.active) data.active = input.active

  if (Object.keys(data).length === 0) return before // nothing changed
  return categoryRepo.update(id, data)
}

export async function deleteCategory(id: string): Promise<{ slug: string; label: string }> {
  const before = await categoryRepo.byId(id)
  if (!before) throw notFound('Category not found')

  const productCount = await categoryRepo.countProductsBySlug(before.slug)
  if (productCount > 0) {
    throw conflict(
      `${productCount} product${productCount === 1 ? '' : 's'} still use${productCount === 1 ? 's' : ''} this category — reassign them first, or hide it instead`,
    )
  }

  await categoryRepo.remove(id)
  return { slug: before.slug, label: before.label }
}
