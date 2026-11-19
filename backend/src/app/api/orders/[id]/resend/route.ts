// POST /api/orders/[id]/resend — admin re-sends delivery email (fresh 72h token)
import { logger } from '@/lib/logger'
import { formatMinor, orderExpectedMinor } from '@/lib/money'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tooMany, asHandler } from '@/lib/api'
import { isAdmin, unauthorized } from '@/lib/admin-auth'
import { resendLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { generateToken, hashToken, maxDownloads } from '@/lib/delivery'
import { sendDeliveryEmail } from '@/lib/email'
import { logEvent } from '@/lib/activity'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) return unauthorized()

  // T7 (§8.2): 10 resends/hour per IP (PG-backed, fail-open) — an email-bomb
  // guard on top of the admin session; legit admin bursts are unlikely.
  const limit = await resendLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const { id } = await params
  try {
    const order = await db.order.findUnique({ where: { id }, include: { product: true } })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.status !== 'paid') return NextResponse.json({ error: 'Order is not paid yet' }, { status: 400 })
    if (!order.product.deliverableUrl) return NextResponse.json({ error: 'No deliverable configured' }, { status: 409 })

    // Did the buyer exhaust the download cap before this resend? The reset
    // below mints a fresh token + zeroed counter either way — the flag only
    // personalises the email ("limit reached, fresh quota issued" vs a plain
    // new link), so the customer never trusts a dead old link again.
    const limitReached = order.downloadCount >= maxDownloads()

    const { plain, hash, expiresAt } = generateToken()
    await db.order.update({
      where: { id },
      data: { downloadTokenHash: hash, tokenExpiresAt: expiresAt, downloadCount: 0 },
    })

    // Same canonical-origin rule as the fulfillment email (order-service):
    // relative hrefs are dead inside email clients. The dev-only fallback
    // mirrors the download route's pageRedirect so locally-tested resends
    // carry a working absolute link; production requires PUBLIC_WEB_URL
    // (boot guard), so the empty-base case cannot happen there.
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.PUBLIC_WEB_URL ||
      (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')

    const email = await sendDeliveryEmail({
      to: order.customerEmail,
      customerName: order.customerName,
      productTitle: order.product.title,
      downloadUrl: `${siteUrl}/#/download/${plain}`,
      // Layer 2: the buyer's verified-review invite (same token, rate page) —
      // parity with the original delivery email.
      rateUrl: `${siteUrl}/#/rate/${plain}`,
      amountInr: order.amountInr,
      amountDisplay: formatMinor(orderExpectedMinor(order), order.currency),
      orderId: order.id,
      limitReached,
    })
    await db.order.update({ where: { id }, data: { emailSent: email.sent } })

    await writeAudit({ action: 'order.email_resent', entity: 'order', entityId: id, label: order.customerEmail, req })
    await logEvent({ type: 'email_resent', email: order.customerEmail, orderId: order.id, productId: order.productId, visitorId: order.visitorId })

    return NextResponse.json({ ok: true, emailDemo: email.demo, limitReset: limitReached })
  } catch (e) {
    logger.error({ err: e }, 'resend failed')
    return NextResponse.json({ error: 'Failed to resend email' }, { status: 500 })
  }
})
