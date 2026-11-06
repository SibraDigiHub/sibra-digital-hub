// GET /api/orders/[id]/invoice — buyer/admin PDF invoice for a PAID order.
//
// Access mirrors the buyer order-status gate exactly:
//   • the buyer's own browser (the __Host-sdh_claim cookie set at checkout
//     create) may fetch ONLY its own order's invoice — same gate as
//     GET /api/orders/[id]/status, so there is no new IDOR surface;
//   • an admin session may fetch any order's invoice;
//   • everyone else gets the standard 401 shape.
// The invoice reference is issued lazily on first download and stays
// immutable (Order.invoiceNumber unique). Additive feature — no existing
// route, DTO or checkout/delivery behaviour is touched.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, conflict, notFound, tooMany, unauthorized } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { readClaimedOrderId } from '@/lib/claim-cookie'
import { checkoutStatusLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { buildInvoicePdf, invoiceFileName, loadInvoiceData } from '@/services/invoice-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const limit = await checkoutStatusLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const { id } = await params
  const claimed = readClaimedOrderId(req)
  if (claimed !== id && !(await isAdmin())) throw unauthorized('Invoice is only available to the buyer or an admin')

  const order = await db.order.findUnique({ where: { id }, select: { status: true } })
  if (!order) throw notFound('Order not found')
  if (order.status !== 'paid') throw conflict('Invoice is available only for paid orders')

  const data = await loadInvoiceData(id)
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
