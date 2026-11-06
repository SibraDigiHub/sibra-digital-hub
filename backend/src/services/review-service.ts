// Verified-purchase review rules (Layer 2). Controllers parse, services decide.
//
// Proof of purchase: the order's DOWNLOAD token (32 random bytes, only its
// SHA-256 stored — the same token the buyer already holds in their delivery
// email / thank-you page). One PAID order ⇒ at most one review (unique
// orderId), and a refunded/revoked/failed order is never reviewable.
// Every review starts 'pending'; only admin-approved rows become public.
import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { conflict, notFound } from '@/lib/api'
import { db } from '@/lib/db'
import { hashToken } from '@/lib/delivery'
import { writeAudit } from '@/lib/audit'
import { productReviewRepo } from '@/repositories/product-review-repo'
import type { ProductReviewRow } from '@/repositories/product-review-repo'
import type { ReviewSubmitInput, ReviewStatus } from '@/validators/review'

/** Public rate-page context — no order emails, no payment ids, no token hashes. */
export interface ReviewContextDTO {
  product: { title: string; slug: string; zone: string }
  customerName: string
  amountInr: number
  review: { rating: number; text: string; status: string } | null
}

/** Public product-review row — never carries orderId or emails. */
export interface PublicReviewDTO {
  id: string
  name: string
  rating: number
  text: string
  createdAt: string
}

export interface RatingSummary {
  avg: number | null
  count: number
}

/** Pure rule: only a PAID order may carry a review (refund/revoke closes it). */
export function isReviewableStatus(orderStatus: string): boolean {
  return orderStatus === 'paid'
}

/** The review invite lives 90 days (approved plan §Phase 1) — measured from
 *  order creation, which provably precedes fulfilment by at most the pending
 *  window (instant-delivery products: seconds). Chosen over back-computing
 *  fulfilment from tokenExpiresAt because the download TTL is configurable
 *  and the extend action grows it. Deliberately LONGER than the 48h download
 *  window: rating stays possible long after the download link has expired. */
export const REVIEW_LINK_TTL_DAYS = 90

/** Pure rule: a paid order's review link is live for 90 days. */
export function isReviewLinkActive(createdAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - createdAt.getTime()
  return ageMs >= 0 && ageMs <= REVIEW_LINK_TTL_DAYS * 24 * 60 * 60 * 1000
}

/** Pure mapper — the ONLY shape a review row may take when leaving the server. */
export function publicReviewDTO(r: ProductReviewRow): PublicReviewDTO {
  return {
    id: r.id,
    name: r.name,
    rating: r.rating,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
  }
}

/** Pure mapper — groupBy row → card/detail summary (avg rounded to 1 decimal). */
export function summaryDTO(row: { _avg: { rating: number | null }; _count: { _all: number } }): RatingSummary {
  const count = row._count._all
  const raw = row._avg.rating
  return { avg: raw === null || count === 0 ? null : Math.round(raw * 10) / 10, count }
}

interface ReviewableOrder {
  id: string
  productId: string
  status: string
  customerName: string
  amountInr: number
  product: { title: string; slug: string; zone: string }
}

/** Token → PAID order (or the exact error the rate page should show). */
async function reviewableOrder(token: string): Promise<ReviewableOrder> {
  const order = await db.order.findUnique({
    where: { downloadTokenHash: hashToken(token) },
    select: {
      id: true,
      productId: true,
      status: true,
      customerName: true,
      amountInr: true,
      createdAt: true,
      product: { select: { title: true, slug: true, zone: true } },
    },
  })
  if (!order || !order.product) throw notFound('This review link is not valid')
  if (!isReviewableStatus(order.status)) {
    throw conflict('This order is no longer eligible for a review')
  }
  if (!isReviewLinkActive(order.createdAt, new Date())) {
    throw conflict('This review link has expired')
  }
  return { ...order, product: order.product }
}

/** Rate-page bootstrap: what the buyer is reviewing + their existing review. */
export async function reviewContext(token: string): Promise<ReviewContextDTO> {
  const order = await reviewableOrder(token)
  const existing = await productReviewRepo.byOrderId(order.id)
  return {
    product: order.product,
    customerName: order.customerName,
    amountInr: order.amountInr,
    review: existing ? { rating: existing.rating, text: existing.text, status: existing.status } : null,
  }
}

/** True iff the unique orderId index rejected a concurrent duplicate. */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * Submit one verified review. 409 when the order already has one — the
 * unique orderId index is the hard backstop, the pre-check only makes the
 * answer friendly. The displayed name defaults to the buyer's order name.
 */
export async function submitReview(input: ReviewSubmitInput): Promise<{ ok: true }> {
  const order = await reviewableOrder(input.token)
  const existing = await productReviewRepo.byOrderId(order.id)
  if (existing) throw conflict('This order has already been reviewed — thank you!')

  try {
    await productReviewRepo.create({
      orderId: order.id,
      productId: order.productId,
      name: input.name ?? order.customerName,
      rating: input.rating,
      text: input.text,
      status: 'pending',
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('This order has already been reviewed — thank you!')
    throw e
  }
  return { ok: true }
}

/** Approved reviews + summary for a published product slug (public page). */
export async function publicReviewsForSlug(slug: string): Promise<{
  summary: RatingSummary
  reviews: PublicReviewDTO[]
} | null> {
  const product = await db.product.findFirst({
    where: { slug, status: 'published' },
    select: { id: true },
  })
  if (!product) return null
  const [rows, agg] = await Promise.all([
    productReviewRepo.listApproved(product.id),
    productReviewRepo.summaries([product.id]),
  ])
  const empty = { _avg: { rating: null }, _count: { _all: 0 } } as const
  return {
    summary: summaryDTO(agg[0] ?? empty),
    reviews: rows.map(publicReviewDTO),
  }
}

/** Card summaries keyed by productId (catalog grids). */
export async function ratingSummaries(): Promise<Record<string, RatingSummary>> {
  const rows = await productReviewRepo.summaries()
  const out: Record<string, RatingSummary> = {}
  for (const row of rows) out[row.productId] = summaryDTO(row)
  return out
}

// ── Admin moderation ─────────────────────────────────────────

export interface AdminReviewDTO extends PublicReviewDTO {
  orderId: string
  status: string
  product: { title: string; slug: string } | null
  updatedAt: string
}

/** Moderation list — newest first, product titles resolved in one batch. */
export async function adminReviewList(status: ReviewStatus | 'all'): Promise<AdminReviewDTO[]> {
  const rows = await productReviewRepo.listAdmin(status)
  const productIds = [...new Set(rows.map((r) => r.productId))]
  const products = productIds.length
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true, slug: true },
      })
    : []
  const byId = new Map(products.map((p) => [p.id, { title: p.title, slug: p.slug }]))
  return rows.map((r) => ({
    ...publicReviewDTO(r),
    orderId: r.orderId,
    status: r.status,
    product: byId.get(r.productId) ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** Approve/reject (idempotent decision change — the queue stays re-editable). */
export async function moderateReview(id: string, status: 'approved' | 'rejected', req?: NextRequest): Promise<{ ok: true }> {
  const updated = await productReviewRepo.updateStatus(id, status).catch(() => null)
  if (!updated) throw notFound('Review not found')
  await writeAudit({
    action: 'review.moderated',
    entity: 'review',
    entityId: id,
    label: updated.name,
    diff: { status, orderId: updated.orderId },
    req,
  })
  return { ok: true }
}

/** Hard delete a review (spam/abuse removal). */
export async function deleteReview(id: string, req?: NextRequest): Promise<{ ok: true }> {
  const removed = await productReviewRepo.remove(id).catch(() => null)
  if (!removed) throw notFound('Review not found')
  await writeAudit({
    action: 'review.deleted',
    entity: 'review',
    entityId: id,
    label: removed.name,
    diff: { orderId: removed.orderId, rating: removed.rating },
    req,
  })
  return { ok: true }
}
