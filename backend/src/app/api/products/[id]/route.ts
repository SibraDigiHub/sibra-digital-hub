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
import { computeMediaRefs, removedManagedRefs } from '@/services/storage-refs'
import { notifyFrontendRevalidate } from '@/services/frontend-revalidation'
import { scheduleDelete } from '@/services/storage-cleanup'

export const dynamic = 'force-dynamic'

export const PATCH = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req)
  const { id } = await params
  const body = (await readJsonCapped(req)) as Record<string, unknown>

  const before = await productRepo.byId(id)
  if (!before) throw notFound('Product not found')

  const { data, action } = applyProductPatch(body)
  // ── Storage cleanup (additive): merge the admin session's uploaded
  // fileIds into the registry, keyed to the FINAL field values.
  if (body.mediaFileIds !== undefined || data.images !== undefined || data.videoPreviewUrl !== undefined || data.fullVideoUrl !== undefined || data.deliverableUrl !== undefined) {
    data.mediaRefs = computeMediaRefs(before.mediaRefs, body.mediaFileIds as Record<string, string> | undefined, {
      images: (data.images as string | undefined) ?? before.images,
      videoPreviewUrl: (data.videoPreviewUrl as string | null | undefined) ?? before.videoPreviewUrl,
      fullVideoUrl: (data.fullVideoUrl as string | null | undefined) ?? before.fullVideoUrl,
      deliverableUrl: (data.deliverableUrl as string | null | undefined) ?? before.deliverableUrl,
    })
  }

  const product = await productRepo.update(id, data)

  // ONLY AFTER the DB commit: schedule refcounted deletion of managed
  // files this save removed/replaced (never fails the save).
  const removed = removedManagedRefs(before, product)
  let scheduled = 0
  if (removed.length > 0) {
    scheduled = await scheduleDelete(removed, 'product_update', id)
  }

  // Revalidate only when this save changes public catalog content or moves
  // a product into/out of the published state. Run after the DB commit;
  // notification failure is best-effort and does not undo the admin save.
  const changed = Object.keys(data).filter(
    (k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((product as Record<string, unknown>)[k]),
  )
  if (changed.length > 0 && (before.status === 'published' || product.status === 'published')) {
    await notifyFrontendRevalidate()
  }
  await writeAudit({
    action,
    entity: 'product',
    entityId: id,
    label: product.title,
    diff: { fields: changed, ...(scheduled > 0 ? { storageCleanupScheduled: scheduled } : {}) },
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
    // Snapshot the product's managed files BEFORE the row is gone.
    const orphans = removedManagedRefs(product, { images: '[]', videoPreviewUrl: null, fullVideoUrl: null, deliverableUrl: null })
    await productRepo.remove(id)
    // ONLY AFTER the DB commit: refcounted cleanup of the purged product's
    // files (shared files survive — refcount across duplicate products).
    let scheduled = 0
    if (orphans.length > 0) {
      scheduled = await scheduleDelete(orphans, 'product_purge', id)
    }
    if (product.status === 'published') await notifyFrontendRevalidate()
    await writeAudit({ action: 'product.purge', entity: 'product', entityId: id, label: product.title, diff: { orderCount, ...(scheduled > 0 ? { storageCleanupScheduled: scheduled } : {}) }, req })
    return json({ ok: true, purged: true })
  }

  // Default: soft delete → trash (orders stay intact, store hides it)
  if (product.status === 'archived') return json({ ok: true, archived: true })
  await productRepo.update(id, { status: 'archived', featured: false })
  if (product.status === 'published') await notifyFrontendRevalidate()
  await writeAudit({ action: 'product.archive', entity: 'product', entityId: id, label: product.title, req })
  return json({ ok: true, archived: true })
})
