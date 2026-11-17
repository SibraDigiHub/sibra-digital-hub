// GET /api/download/[token]/invoice — the buyer's PDF invoice, authorised by
// the SAME delivery token as the download itself.
//
// Why: the invoice at /api/orders/[id]/invoice is gated by the checkout
// claim cookie (set on the paying browser for 2h) or an admin session —
// but the download page opens from the DELIVERY EMAIL on any device, where
// no claim cookie exists. The download token is already the buyer's bearer
// credential for this exact order, so it authorises exactly its own order's
// invoice. Invoice access deliberately survives token EXPIRY (a paid
// buyer's proof-of-purchase does not expire — only the file downloads do);
// the paid-status check below still blocks refunded/revoked orders.
//
// Errors mirror /api/orders/[id]/invoice shapes (404 unknown token,
// 409 not paid, 429 rate-limited). The invoice reference stays lazily
// issued and immutable (Order.invoiceNumber unique).
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, conflict, notFound, tooMany } from '@/lib/api'
import { checkoutStatusLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { hashToken } from '@/lib/delivery'
import { db } from '@/lib/db'
import { buildInvoicePdf, invoiceFileName, loadInvoiceData } from '@/services/invoice-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const limit = await checkoutStatusLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const { token } = await params
  // Same minimum length the download route enforces before a DB lookup.
  if (!token || token.length < 16) throw notFound('Invoice not found')

  const order = await db.order.findUnique({
    where: { downloadTokenHash: hashToken(token) },
    select: { id: true, status: true },
  })
  if (!order) throw notFound('Invoice not found')
  if (order.status !== 'paid') throw conflict('Invoice is available only for paid orders')

  const data = await loadInvoiceData(order.id)
  const bytes = await buildInvoicePdf(data)

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceFileName(data.invoiceNumber)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
})
