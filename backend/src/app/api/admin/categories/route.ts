// GET  /api/admin/categories — full list (incl. hidden) + product counts (T10)
// POST /api/admin/categories — create a new category
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody, parseQuery } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { writeAudit } from '@/lib/audit'
import { adminListCategories, createCategory } from '@/services/category-service'
import { categoryCreateSchema, categoryListQuerySchema } from '@/validators/category'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const query = parseQuery(req, categoryListQuerySchema)
  return json({ categories: await adminListCategories(query.zone) })
})

export const POST = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const input = await parseBody(req, categoryCreateSchema)
  const category = await createCategory(input)
  await writeAudit({
    action: 'category.create',
    entity: 'Category',
    entityId: category.id,
    label: `${category.emoji} ${category.label}`,
    diff: { zone: category.zone, slug: category.slug, sortOrder: category.sortOrder },
    req,
  })
  return json({ category }, { status: 201 })
})
