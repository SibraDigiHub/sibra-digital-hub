// PATCH  /api/admin/categories/[id] — rename / re-emoji / reorder / hide (T10)
// DELETE /api/admin/categories/[id] — remove (blocked while products use it)
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody, unauthorized } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { writeAudit } from '@/lib/audit'
import { deleteCategory, updateCategory } from '@/services/category-service'
import { categoryUpdateSchema } from '@/validators/category'

export const dynamic = 'force-dynamic'

export const PATCH = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  const input = await parseBody(req, categoryUpdateSchema)
  const category = await updateCategory(id, input)
  await writeAudit({
    action: 'category.update',
    entity: 'Category',
    entityId: id,
    label: `${category.emoji} ${category.label}`,
    diff: { fields: Object.keys(input) },
    req,
  })
  return json({ category })
})

export const DELETE = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  const removed = await deleteCategory(id)
  await writeAudit({
    action: 'category.delete',
    entity: 'Category',
    entityId: id,
    label: removed.label,
    diff: { slug: removed.slug },
    req,
  })
  return json({ ok: true })
})
