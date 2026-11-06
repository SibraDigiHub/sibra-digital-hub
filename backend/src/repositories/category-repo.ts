// T10 — Prisma access for admin-managed product categories.
// Kept deliberately tiny; business rules live in category-service.
import { db } from '@/lib/db'
import type { CategoryCreateInput, CategoryUpdateInput } from '@/validators/category'

export interface CategoryRow {
  id: string
  zone: string
  slug: string
  label: string
  emoji: string
  blurb: string
  sortOrder: number
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export const categoryRepo = {
  listAll(): Promise<CategoryRow[]> {
    return db.category.findMany({
      orderBy: [{ zone: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
  },

  listActive(zone?: string): Promise<CategoryRow[]> {
    return db.category.findMany({
      where: { active: true, ...(zone ? { zone } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
  },

  byId(id: string): Promise<CategoryRow | null> {
    return db.category.findUnique({ where: { id } })
  },

  bySlug(slug: string): Promise<CategoryRow | null> {
    return db.category.findUnique({ where: { slug } })
  },

  create(input: CategoryCreateInput & { slug: string; sortOrder: number }): Promise<CategoryRow> {
    return db.category.create({
      data: {
        zone: input.zone,
        slug: input.slug,
        label: input.label,
        emoji: input.emoji ?? '📦',
        blurb: input.blurb ?? '',
        sortOrder: input.sortOrder,
      },
    })
  },

  update(id: string, data: Partial<CategoryUpdateInput>): Promise<CategoryRow> {
    return db.category.update({ where: { id }, data })
  },

  remove(id: string): Promise<CategoryRow> {
    return db.category.delete({ where: { id } })
  },

  /** Products still pointing at a category slug (any status). */
  countProductsBySlug(slug: string): Promise<number> {
    return db.product.count({ where: { category: slug } })
  },

  /** Product counts per slug, for the admin table badge. */
  countProductsBySlugs(slugs: string[]): Promise<Record<string, number>> {
    return db.product
      .groupBy({ by: ['category'], _count: { _all: true }, where: { category: { in: slugs } } })
      .then((rows) => {
        const out: Record<string, number> = {}
        for (const r of rows) out[r.category] = r._count._all
        return out
      })
  },

  nextSortOrder(zone: string): Promise<number> {
    return db.category
      .aggregate({ where: { zone }, _max: { sortOrder: true } })
      .then((r) => (r._max.sortOrder ?? 0) + 1)
  },
}
