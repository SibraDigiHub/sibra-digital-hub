import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api'
import { allowRepeatPurchase } from '@/config/env'
import { maxDownloads } from '@/lib/delivery'

/**
 * Block a second purchase only while the buyer still has usable access
 * to this product. Expired, revoked, missing, or exhausted access does not
 * prevent a fresh purchase. The caller must hold the per-email checkout lock.
 */
export async function assertNoActiveProductAccess(
  productId: string,
  email: string,
  deliveryMode: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (allowRepeatPurchase()) return

  const now = new Date()
  const activeAccessWhere =
    deliveryMode === 'watch'
      ? {
          // Preview grants replace the buyer's token temporarily and are not customer access.
          watchGrants: {
            some: {
              expiresAt: { gt: now },
              revokedAt: null,
              lockedAt: null,
              preview: false,
            },
          },
          // The watch service rejects grants if the protected video URL is missing.
          product: {
            is: {
              fullVideoUrl: { not: '' },
            },
          },
        }
      : {
          downloadTokenHash: { not: null },
          tokenExpiresAt: { gt: now },
          downloadCount: { lt: maxDownloads() },
          // The download route cannot serve an order if the product's
          // deliverable was removed or left unconfigured after purchase.
          product: {
            is: {
              deliverableUrl: { not: '' },
            },
          },
        }

  const existing = await tx.order.findFirst({
    where: {
      productId,
      customerEmail: email,
      status: 'paid',
      ...activeAccessWhere,
    },
    select: { id: true },
  })

  if (existing) {
    throw new ApiError(
      409,
      'You already have active access to this product — check your inbox for the delivery email, or use "Resend my link" below.',
      'REPEAT_PURCHASE',
    )
  }
}
