// GET /api/admin/system — integrations health + operational alerts
// (PRD v6.1 §11.8 Integrations + demo-mode notice).
// T4: passcode/session-secret checks replaced by the real auth secrets
// (ENCRYPTION_KEY + SESSION_PEPPER — see config/env.ts production guard).
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { authSecretsStatus, internationalCheckoutEnabled, razorpayForeignCurrencies } from '@/config/env'
import {
  RECONCILE_HEARTBEAT_KEY,
  RETRY_EMAILS_HEARTBEAT_KEY,
  HEARTBEAT_WARN_MS,
  heartbeatStale,
} from '@/services/cron-heartbeat'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)

  // DB ping
  let dbOk = true
  try {
    await db.product.count()
  } catch {
    dbOk = false
  }

  const razorpayOk = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  const imagekitOk = Boolean(process.env.IMAGEKIT_PRIVATE_KEY && process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  const resendOk = Boolean(process.env.RESEND_API_KEY)
  const authSecretsOk = authSecretsStatus()
  const internationalOk = internationalCheckoutEnabled()

  const [archivedCount, pendingCount, failedEmailCount, events24h, webhookFailures, lastWebhook, failedEmailsToday, reconcileBeat, retryEmailsBeat] = await Promise.all([
    db.product.count({ where: { status: 'archived' } }),
    db.order.count({ where: { status: 'pending' } }),
    db.order.count({ where: { status: 'paid', emailSent: false } }),
    db.activityEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    db.order.count({ where: { status: 'failed' } }),
    db.webhookEvent.findFirst({ orderBy: { processedAt: 'desc' }, select: { processedAt: true, gateway: true } }),
    db.emailLog.count({ where: { ok: false, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    db.cronHeartbeat.findUnique({ where: { key: RECONCILE_HEARTBEAT_KEY } }),
    db.cronHeartbeat.findUnique({ where: { key: RETRY_EMAILS_HEARTBEAT_KEY } }),
  ])

  const alerts: { level: 'info' | 'warn'; text: string }[] = []
  if (!razorpayOk) alerts.push({ level: 'info', text: 'Demo mode: payments are simulated. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET for live checkout payments.' })
  if (!internationalOk) alerts.push({ level: 'info', text: 'International checkout is OFF (INTERNATIONAL_CHECKOUT_ENABLED=false) — non-India buyers see the marketplace fallback. Enable it after Razorpay International is activated in the Dashboard.' })
  if (!resendOk) alerts.push({ level: 'info', text: 'Demo mode: delivery emails are logged, not sent. Add RESEND_API_KEY to email real download links.' })
  if (!imagekitOk) alerts.push({ level: 'info', text: 'Uploads are stored locally. Add the ImageKit keys for CDN delivery.' })
  if (!authSecretsOk) alerts.push({ level: 'warn', text: 'Admin auth secrets (ENCRYPTION_KEY / SESSION_PEPPER) are missing or weak — production will refuse to start.' })
  if (failedEmailCount > 0) alerts.push({ level: 'warn', text: `${failedEmailCount} paid order(s) never got a delivery email — open Orders and re-send.` })
  if (pendingCount > 3) alerts.push({ level: 'info', text: `${pendingCount} pending checkouts awaiting payment.` })

  // P4: a silent payments cron means lost-webhook payments are never
  // fulfilled and failed delivery emails are never retried.
  const now = new Date()
  if (heartbeatStale(reconcileBeat?.lastSuccessAt, now, HEARTBEAT_WARN_MS)) {
    const mins = Math.floor((now.getTime() - (reconcileBeat?.lastSuccessAt?.getTime() ?? 0)) / 60_000)
    alerts.push({ level: 'warn', text: `Payments reconciliation has not run for ${mins} minutes — paid orders with lost webhooks stay unfulfilled. Check the cron scheduler (docs/DEPLOYMENT.md).` })
  }
  if (heartbeatStale(retryEmailsBeat?.lastSuccessAt, now, HEARTBEAT_WARN_MS)) {
    const mins = Math.floor((now.getTime() - (retryEmailsBeat?.lastSuccessAt?.getTime() ?? 0)) / 60_000)
    alerts.push({ level: 'warn', text: `Delivery-email retries have not run for ${mins} minutes — failed emails are not being retried. Check the cron scheduler (docs/DEPLOYMENT.md).` })
  }

  return json({
    integrations: {
      database: dbOk,
      razorpay: razorpayOk,
      international: internationalOk,
      imagekit: imagekitOk,
      resend: resendOk,
      authSecrets: authSecretsOk,
    },
    // §9 integrations health: configured/mode + last webhook + failed emails today.
    payments: {
      razorpayMode: process.env.RAZORPAY_MODE ?? (razorpayOk ? 'unknown' : 'demo'),
      internationalEnabled: internationalOk,
      foreignCurrencies: razorpayForeignCurrencies(),
      lastWebhookAt: lastWebhook?.processedAt ?? null,
      lastWebhookGateway: lastWebhook?.gateway ?? null,
      failedEmailsToday,
    },
    // P4: last successful run of each payments cron (null = never ran).
    cronHeartbeats: {
      reconcilePayments: reconcileBeat?.lastSuccessAt?.toISOString() ?? null,
      retryEmails: retryEmailsBeat?.lastSuccessAt?.toISOString() ?? null,
    },
    demoMode: !razorpayOk || !resendOk,
    counters: { archivedProducts: archivedCount, pendingOrders: pendingCount, failedEmails: failedEmailCount, failedPayments: webhookFailures, events24h },
    alerts,
  })
})
