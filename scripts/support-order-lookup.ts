// ═══════════════════════════════════════════════════════════
// support-order-lookup.ts — READ-ONLY support/incident tool.
//
//   DATABASE_URL=… bun scripts/support-order-lookup.ts --order <id|rzp_pay_…|paypalOrderId>
//
// Prints a masked timeline for one order: status, gateway attempts,
// webhook events + results, delivery outbox + e-mail log, download
// state, risk flags and cron heartbeats. SELECT-only; e-mails are
// masked (a***@d***.com), hashes/tokens never printed in full.
// Pair it with the playbooks in docs/RUNBOOK.md.
// ═══════════════════════════════════════════════════════════

import { Client } from 'pg'
import { maskEmail } from './_lib'

function parseArgs(): { dbUrl: string; ref: string } {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i > -1 ? argv[i + 1] : undefined
  }
  const dbUrl = get('--db') ?? process.env.DATABASE_URL
  const ref = get('--order')
  if (!dbUrl || !ref) {
    console.error('usage: bun scripts/support-order-lookup.ts --order <reference> [--db postgresql://…]')
    process.exit(1)
  }
  return { dbUrl, ref }
}

interface OrderRow {
  id: string
  status: string
  gateway: string
  currency: string
  amountMinor: number | null
  billingCountry: string | null
  ipCountry: string | null
  consentAt: Date | null
  createdAt: Date
  updatedAt: Date
  downloadCount: number
  tokenExpiresAt: Date | null
  emailSent: boolean
  riskFlags: string[]
  customerEmail: string
  razorpayPaymentId: string | null
  paypalOrderId: string | null
  paypalCaptureId: string | null
  productTitle: string | null
}

async function findOrder(c: Client, ref: string): Promise<OrderRow | null> {
  const { rows } = await c.query<OrderRow>(
    `SELECT o.id, o.status, o.gateway, o.currency, o."amountMinor", o."billingCountry", o."ipCountry",
            o."consentAt", o."createdAt", o."updatedAt", o."downloadCount", o."tokenExpiresAt",
            o."emailSent", o."riskFlags", o."customerEmail", o."razorpayPaymentId",
            o."paypalOrderId", o."paypalCaptureId", p.title AS "productTitle"
     FROM "Order" o LEFT JOIN "Product" p ON p.id = o."productId"
     WHERE o.id = $1 OR o."razorpayPaymentId" = $1 OR o."paypalOrderId" = $1 OR o."paypalCaptureId" = $1
     LIMIT 1`,
    [ref],
  )
  return rows[0] ?? null
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(26)} ${value === null || value === undefined || value === '' ? '—' : String(value)}`)
}

function ts(d: Date | null): string {
  return d ? d.toISOString() : '—'
}

async function timeline(c: Client, id: string, email: string): Promise<void> {
  line('customer (masked)', maskEmail(email))

  const attempts = await c.query<{ gateway: string; status: string; errorCode: string | null; createdAt: Date }>(
    `SELECT gateway, status, "errorCode", "createdAt" FROM "PaymentAttempt" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [id],
  )
  console.log(`  gateway attempts (${attempts.rowCount})`)
  for (const a of attempts.rows) console.log(`    ${ts(a.createdAt)}  ${a.gateway.padEnd(9)} ${a.status}${a.errorCode ? ` — ${a.errorCode}` : ''}`)

  const events = await c.query<{ gateway: string; type: string; result: string | null; processedAt: Date; eventId: string }>(
    `SELECT gateway, type, result, "processedAt", "eventId" FROM "WebhookEvent" ORDER BY "processedAt" DESC LIMIT 10`,
  )
  console.log(`  webhook events (most recent ${events.rowCount} — the table does not store per-order linkage)`)
  for (const e of events.rows) console.log(`    ${ts(e.processedAt)}  ${e.gateway.padEnd(9)} ${e.type.padEnd(28)} result=${e.result ?? '—'} event=${e.eventId.slice(0, 18)}…`)

  const audits = await c.query<{ action: string; label: string | null; createdAt: Date }>(
    `SELECT action, label, "createdAt" FROM "AuditLog" WHERE "entityId" = $1 OR entity = 'order' AND label LIKE '%' || $2 || '%' ORDER BY "createdAt" DESC LIMIT 10`,
    [id, id.slice(-8)],
  )
  console.log(`  audit trail (${audits.rowCount})`)
  for (const a of audits.rows) console.log(`    ${ts(a.createdAt)}  ${a.action}${a.label ? ` — ${a.label.slice(0, 60)}` : ''}`)

  const outbox = await c.query<{ template: string; status: string; attempts: number; sentAt: Date | null; lastError: string | null; nextAttemptAt: Date }>(
    `SELECT template, status, attempts, "sentAt", "lastError", "nextAttemptAt" FROM "EmailOutbox" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [id],
  )
  console.log(`  delivery outbox (${outbox.rowCount})`)
  for (const o of outbox.rows) {
    console.log(`    ${o.template.padEnd(16)} ${o.status.padEnd(7)} attempts=${o.attempts} sentAt=${ts(o.sentAt)} next=${ts(o.nextAttemptAt)}${o.lastError ? ` lastError=${o.lastError.slice(0, 80)}` : ''}`)
  }

  const logs = await c.query<{ template: string | null; provider: string; ok: boolean; attempt: number; error: string | null; createdAt: Date }>(
    `SELECT template, provider, ok, attempt, error, "createdAt" FROM "EmailLog" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [id],
  )
  console.log(`  e-mail log (${logs.rowCount})`)
  for (const l of logs.rows) console.log(`    ${ts(l.createdAt)}  ${l.provider.padEnd(8)} ok=${String(l.ok)} attempt=${l.attempt}${l.error ? ` error=${l.error.slice(0, 80)}` : ''}`)

  const heartbeats = await c.query<{ key: string; lastSuccessAt: Date }>(`SELECT key, "lastSuccessAt" FROM "CronHeartbeat" ORDER BY key`)
  console.log(`  cron heartbeats (${heartbeats.rowCount})`)
  for (const h of heartbeats.rows) console.log(`    ${h.key.padEnd(22)} last success ${ts(h.lastSuccessAt)}`)
}

async function main(): Promise<void> {
  const { dbUrl, ref } = parseArgs()
  const client = new Client({ connectionString: dbUrl, options: '-c default_transaction_read_only=on' })
  await client.connect()
  const order = await findOrder(client, ref)
  if (!order) {
    await client.end()
    console.error(`support-order-lookup: no order matches "${ref.slice(0, 8)}…"`)
    process.exit(1)
  }
  console.log(`\norder ${order.id}`)
  line('product', order.productTitle)
  line('status', order.status)
  line('gateway / currency', `${order.gateway} / ${order.currency}`)
  line('amountMinor', order.amountMinor)
  line('billing / ip country', `${order.billingCountry ?? '—'} / ${order.ipCountry ?? '—'}`)
  line('consentAt', ts(order.consentAt))
  line('created / updated', `${ts(order.createdAt)} / ${ts(order.updatedAt)}`)
  line('emailSent flag', order.emailSent)
  line('downloadCount', order.downloadCount)
  line('tokenExpiresAt', ts(order.tokenExpiresAt))
  line('gateway ids', `rzp=${order.razorpayPaymentId ?? '—'} ppOrder=${order.paypalOrderId ?? '—'} ppCapture=${order.paypalCaptureId ?? '—'}`)
  line('riskFlags', order.riskFlags.length > 0 ? order.riskFlags.join(', ') : 'none')
  await timeline(client, order.id, order.customerEmail)
  await client.end()
  console.log('')
}

main().catch((e: Error) => {
  console.error(`support-order-lookup failed: ${e.message}`)
  process.exit(1)
})
