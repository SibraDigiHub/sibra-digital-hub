// POST /api/orders/[id]/resend — admin re-sends delivery email (fresh 72h token)
import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tooMany, asHandler } from '@/lib/api'
import { isAdmin, unauthorized } from '@/lib/admin-auth'
import { resendLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { generateToken, hashToken } from '@/lib/delivery'
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

    const { plain, hash, expiresAt } = generateToken()
    await db.order.update({
      where: { id },
      data: { downloadTokenHash: hash, tokenExpiresAt: expiresAt, downloadCount: 0 },
    })

    const email = await sendDeliveryEmail({
      to: order.customerEmail,
      customerName: order.customerName,
      productTitle: order.product.title,
      // Same site-qualified URL the delivery/outbox senders use — a relative
      // href cannot resolve inside an email client (resent links were dead).
      downloadUrl: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL || ''}/#/download/${plain}`,
      // Layer 2: the buyer's verified-review invite (same token, rate page).
      rateUrl: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL || ''}/#/rate/${plain}`,
      amountInr: order.amountInr,
      orderId: order.id,
    })
    await db.order.update({ where: { id }, data: { emailSent: email.sent } })

    await writeAudit({ action: 'order.email_resent', entity: 'order', entityId: id, label: order.customerEmail, req })
    await logEvent({ type: 'email_resent', email: order.customerEmail, orderId: order.id, productId: order.productId, visitorId: order.visitorId })

    return NextResponse.json({ ok: true, emailDemo: email.demo })
  } catch (e) {
    logger.error({ err: e }, 'resend failed')
    return NextResponse.json({ error: 'Failed to resend email' }, { status: 500 })
  }
})
