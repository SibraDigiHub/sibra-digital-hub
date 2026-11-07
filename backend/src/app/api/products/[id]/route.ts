// PATCH  /api/products/[id] — admin update (partial)
// DELETE /api/products/[id] — admin soft-delete (archive → trash)
//   ?purge=1  → hard delete (only when the product has no orders)
import { NextRequest } from 'next/server'
import { asHandler, json, readJsonCapped, conflict, notFound } from '@/lib/api'
import { requireAdmin } from '@/lib/auth/session'
import { writeAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { orderRepo } from '@/repositories/order-repo'
import { productRepo } from '@/repositories/product-repo'
import { applyProductPatch, productExists } from '@/services/product-service'

export const dynamic = 'force-dynamic'

export const PATCH = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req)
  const { id } = await params
  const body = (await readJsonCapped(req)) as Record<string, unknown>

  const before = await productRepo.byId(id)
  if (!before) throw notFound('Product not found')

  const { data, action } = applyProductPatch(body)
  const product = await productRepo.update(id, data)

  // Audit trail: record which fields changed
  const changed = Object.keys(data).filter(
    (k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((product as Record<string, unknown>)[k]),
  )
  await writeAudit({
    action,
    entity: 'product',
    entityId: id,
    label: product.title,
    diff: { fields: changed },
    req,
  })
  return json({ product })
})

export const DELETE = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req)
  const { id } = await params
  const purge = req.nextUrl.searchParams.get('purge') === '1'

  const product = await productExists(id)
  if (!product) throw notFound('Product not found')

  const orderCount = await orderRepo.countByProduct(id)

  if (purge) {
    // Hard delete — blocked while purchase history exists (PRD §11.2:
    // orders for archived products stay intact)
    if (orderCount > 0) {
      throw conflict(`This product has ${orderCount} order(s) — keep it archived so purchase history stays intact.`)
    }
    await productRepo.remove(id)
    await writeAudit({ action: 'product.purge', entity: 'product', entityId: id, label: product.title, diff: { orderCount }, req })
    return json({ ok: true, purged: true })
  }

  // Default: soft delete → trash (orders stay intact, store hides it)
  if (product.status === 'archived') return json({ ok: true, archived: true })
  await productRepo.update(id, { status: 'archived', featured: false })
  await writeAudit({ action: 'product.archive', entity: 'product', entityId: id, label: product.title, req })
  return json({ ok: true, archived: true })
})
