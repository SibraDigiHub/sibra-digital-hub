// ═══════════════════════════════════════════════════════════
// payments-sandbox-assist.ts — STAGING-ONLY payment verification.
//
//   bun scripts/payments-sandbox-assist.ts --guided
//   bun scripts/payments-sandbox-assist.ts --verify --order <id> [--token <plainToken>]
//   bun scripts/payments-sandbox-assist.ts --replay-razorpay --order <id>
//   bun scripts/payments-sandbox-assist.ts --paypal-replay
//   bun scripts/payments-sandbox-assist.ts --lost-webhook --order <id>
//
// Refuses to run unless STAGING_CONFIRM=yes AND the target backend's
// health reports a non-production posture (demoMode or
// testPaymentsAllowed true). A production posture aborts instantly.
// DB access is SELECT-only (read-only transaction). Mutating steps
// (download claims, webhook replay) exist ONLY for Razorpay TEST /
// PayPal SANDBOX orders on staging and say so loudly.
// ═══════════════════════════════════════════════════════════

import { Client } from 'pg'
import { fetchWithTimeout, maskSecret, printCheckTable, type Check, pass, fail } from './_lib'

const TTL_HOURS = Number(process.env.DOWNLOAD_TTL_HOURS ?? 48)
const MAX_DOWNLOADS = Number(process.env.DOWNLOAD_MAX_DEFAULT ?? 5)
const CLAIM_LIMIT_MS = 600_000 // signed URL life: 10 minutes

interface AssistArgs {
  mode: 'guided' | 'verify' | 'replay-razorpay' | 'paypal-replay' | 'lost-webhook'
  order?: string
  token?: string
  frontendUrl: string
  backendUrl: string
  dbUrl: string
}

function parseArgs(): AssistArgs {
  const argv = process.argv.slice(2)
  const get = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined)
  const mode = argv.includes('--verify') ? 'verify' : argv.includes('--replay-razorpay') ? 'replay-razorpay' : argv.includes('--paypal-replay') ? 'paypal-replay' : argv.includes('--lost-webhook') ? 'lost-webhook' : 'guided'
  const frontendUrl = (process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
  const backendUrl = (process.env.BACKEND_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
  return { mode, order: get('--order'), token: get('--token'), frontendUrl, backendUrl, dbUrl: process.env.DATABASE_URL ?? '' }
}

async function stagingPosture(url: string): Promise<{ ok: boolean; demoMode: boolean; testPaymentsAllowed: boolean }> {
  const res = await fetchWithTimeout(`${url}/api`, {}, 10_000)
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const demoMode = body.demoMode === true
  const testPaymentsAllowed = body.testPaymentsAllowed === true
  return { ok: res.status === 200 && body.ok === true && (demoMode || testPaymentsAllowed), demoMode, testPaymentsAllowed }
}

function guardRefusal(reason: string): never {
  console.error(`payments-sandbox-assist: REFUSED — ${reason}`)
  process.exit(1)
}

// ── guided matrix ───────────────────────────────────────────────
function guided(): void {
  const steps: Array<[string, string]> = [
    ['1. Success — Razorpay test', `Checkout on ${'#/'}, pay with test card 4111 1111 1111 1111 (any future expiry, any CVV). EXPECT: thank-you view, delivery e-mail in the staging inbox, order PAID in Admin → Orders.`],
    ['2. Success — PayPal sandbox', 'Pay with a SANDBOX buyer account. EXPECT: same as step 1, gateway=paypal, currency=USD.'],
    ['3. Failure', 'Use test card 4000 0000 0000 0002 (declined). EXPECT: order stays pending, failure recorded, no e-mail.'],
    ['4. Cancel / abandon', 'Close the Razorpay dialog at the bank page. EXPECT: order pending; cron reconcile marks it failed after 24 h (staging: verify via db-integrity).'],
    ['5. Double payment', 'Complete payment, then re-open the checkout for the same order. EXPECT: "already paid" state; only one token + one e-mail exist.'],
    ['6. Wrong country', 'Start checkout with billing country India, then retry as US. EXPECT: gateway switches (IN→Razorpay/INR, US→PayPal/USD); a mismatch is flagged COUNTRY_MISMATCH.'],
    ['7. Expired link', 'Wait out DOWNLOAD_TTL_HOURS (default 48 h) or shrink the token expiry in DB for the test order. EXPECT: download page shows the expiry message (HTTP 410 semantics).'],
    ['8. Refund', `Refund in the Razorpay/ PayPal dashboard (or Admin → Orders). EXPECT: order → refunded, downloads revoked (REVOKE_ON_REFUND), audit trail entry.`],
    ['', ''],
    ['After each successful payment', 'Run: bun scripts/payments-sandbox-assist.ts --verify --order <orderId> --token <token-from-email>'],
    ['Webhook idempotency (Razorpay)', 'bun scripts/payments-sandbox-assist.ts --replay-razorpay --order <orderId>'],
    ['Webhook idempotency (PayPal)', 'bun scripts/payments-sandbox-assist.ts --paypal-replay  (dashboard resend steps + DB check)'],
    ['Lost-webhook drill', 'bun scripts/payments-sandbox-assist.ts --lost-webhook --order <orderId>'],
  ]
  console.log('STAGING PAYMENT TEST MATRIX — tick the boxes as you go (full matrix: docs/STAGING_TEST_MATRIX.md)\n')
  for (const [head, body] of steps) console.log(head ? `[ ] ${head}\n    ${body}` : '')
}

// ── DB helpers (read-only) ──────────────────────────────────────
async function readOnlyClient(dbUrl: string): Promise<Client> {
  const client = new Client({ connectionString: dbUrl, options: '-c default_transaction_read_only=on' })
  await client.connect()
  return client
}

interface OrderLite {
  id: string
  status: string
  gateway: string
  currency: string
  amountMinor: number | null
  amountInr: number
  billingCountry: string | null
  downloadTokenHash: string | null
  tokenExpiresAt: Date | null
  downloadCount: number
}

async function fetchOrder(c: Client, id: string): Promise<OrderLite | null> {
  const { rows } = await c.query<OrderLite>(
    `SELECT id, status, gateway, currency, "amountMinor", "amountInr", "billingCountry",
            "downloadTokenHash", "tokenExpiresAt", "downloadCount" FROM "Order" WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

async function pollUntilPaid(c: Client, id: string, timeoutMs: number): Promise<OrderLite | null> {
  const first = await fetchOrder(c, id)
  if (!first) return null // unknown order — refuse immediately, do not poll
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const order = await fetchOrder(c, id)
    if (order?.status === 'paid') return order
    await new Promise((r) => setTimeout(r, 5000))
  }
  return fetchOrder(c, id)
}

// ── --verify: post-payment invariants ───────────────────────────
async function verify(args: AssistArgs): Promise<void> {
  if (!args.order) guardRefusal('--verify needs --order <orderId>')
  const client = await readOnlyClient(args.dbUrl)
  const checks: Check[] = []
  const order = await pollUntilPaid(client, args.order, 10 * 60_000)
  if (!order) guardRefusal(`order ${args.order} not found in DATABASE_URL database`)
  checks.push(order.status === 'paid' ? pass('paid', `order ${order.id.slice(0, 8)}… is PAID`, `gateway=${order.gateway} currency=${order.currency}`) : fail('paid', 'order reached PAID', `status=${order.status} after 10 min polling`))

  const routingOk =
    (order.billingCountry === 'IN' && order.gateway === 'razorpay' && order.currency === 'INR') ||
    (order.billingCountry !== 'IN' && order.gateway === 'paypal' && order.currency === 'USD')
  checks.push(routingOk ? pass('routing', 'gateway/currency match routing rules', `${order.billingCountry}→${order.gateway}/${order.currency}`) : fail('routing', 'gateway/currency match routing rules', `${order.billingCountry}→${order.gateway}/${order.currency}`))

  const outbox = await client.query<{ template: string; status: string; sentAt: Date | null; createdAt: Date }>(
    `SELECT template, status, "sentAt", "createdAt" FROM "EmailOutbox" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [order.id],
  )
  const sentRows = outbox.rows.filter((r) => r.status === 'SENT')
  checks.push(
    outbox.rowCount === 1 && sentRows.length === 1
      ? pass('outbox', 'exactly one delivery e-mail outbox row, SENT', `template=${outbox.rows[0].template} sentAt=${outbox.rows[0].sentAt?.toISOString() ?? '—'}`)
      : fail('outbox', 'exactly one SENT outbox row', `${outbox.rowCount} row(s), ${sentRows.length} SENT`),
  )

  checks.push(order.downloadTokenHash ? pass('token', 'one download token minted (hash stored)', `hash ${maskSecret(order.downloadTokenHash)}`) : fail('token', 'one download token minted', 'downloadTokenHash missing'))
  const fulfilAt = outbox.rows[0]?.createdAt ?? null
  if (order.tokenExpiresAt && fulfilAt) {
    const ttlMs = order.tokenExpiresAt.getTime() - fulfilAt.getTime()
    const expected = TTL_HOURS * 3_600_000
    const driftMin = Math.abs(ttlMs - expected) / 60_000
    checks.push(driftMin <= 10 ? pass('ttl', `expiry ≈ DOWNLOAD_TTL_HOURS (${TTL_HOURS} h)`, `drift ${driftMin.toFixed(1)} min`) : fail('ttl', `expiry ≈ DOWNLOAD_TTL_HOURS (${TTL_HOURS} h)`, `drift ${driftMin.toFixed(1)} min — expected ~${TTL_HOURS} h`))
  } else {
    checks.push(fail('ttl', 'expiry ≈ DOWNLOAD_TTL_HOURS', 'tokenExpiresAt or fulfillment time unknown'))
  }

  if (args.token) {
    const base = `${args.frontendUrl}/api/download/${args.token}`
    let allFree = true
    for (let i = 0; i < 10; i++) {
      const res = await fetchWithTimeout(`${base}?mode=json`, { method: 'GET' })
      if (res.status !== 200) allFree = false
    }
    const after = await fetchOrder(client, order.id)
    checks.push(allFree && after?.downloadCount === 0 ? pass('get-free', '10× GET never consumed a download', 'downloadCount still 0') : fail('get-free', '10× GET never consumed a download', `downloadCount=${after?.downloadCount}`))

    let claimRes: Response | null = null
    let claims = 0
    for (let i = 0; i < MAX_DOWNLOADS; i++) {
      claimRes = await fetchWithTimeout(`${base}?mode=json`, { method: 'POST' })
      if (claimRes.status === 200) claims += 1
    }
    const sixth = await fetchWithTimeout(`${base}?mode=json`, { method: 'POST' })
    const finalOrder = await fetchOrder(client, order.id)
    checks.push(
      claims === MAX_DOWNLOADS && sixth.status === 429 && finalOrder?.downloadCount === MAX_DOWNLOADS
        ? pass('claims', `exactly ${MAX_DOWNLOADS} POST claims, ${MAX_DOWNLOADS + 1}th refused`, `claims=${claims} 6th=${sixth.status} count=${finalOrder?.downloadCount}`)
        : fail('claims', `exactly ${MAX_DOWNLOADS} POST claims, ${MAX_DOWNLOADS + 1}th refused`, `claims=${claims} 6th=${sixth.status} count=${finalOrder?.downloadCount}`),
    )
    if (claimRes?.status === 200) {
      const body = (await claimRes.json().catch(() => ({}))) as { fileUrl?: string }
      const expParam = body.fileUrl?.match(/[?&](?:ik-exp|exp)=(\d{10,13})/)?.[1]
      if (expParam) {
        const expMs = expParam.length > 12 ? Number(expParam) : Number(expParam) * 1000
        const ttlSec = (expMs - Date.now()) / 1000
        checks.push(ttlSec > 0 && ttlSec <= CLAIM_LIMIT_MS / 1000 ? pass('signed-url', 'signed URL expires within 10 min', `ttl≈${ttlSec.toFixed(0)}s`) : fail('signed-url', 'signed URL expires within 10 min', `ttl≈${ttlSec.toFixed(0)}s`))
      } else {
        checks.push(fail('signed-url', 'signed URL expires within 10 min', 'no exp/ik-exp param on returned fileUrl'))
      }
    }
  } else {
    console.log('note: pass --token <plain token from the delivery e-mail> to also run the 10× GET / 5× POST download contract')
  }
  await client.end()
  printCheckTable(`payments verify — order ${order.id}`, checks)
  if (checks.some((c) => c.kind === 'fail')) process.exit(1)
}

// ── --replay-razorpay: signed replay + tamper probe ─────────────
async function replayRazorpay(args: AssistArgs, client: Client): Promise<void> {
  if (!args.order) guardRefusal('--replay-razorpay needs --order <orderId>')
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) guardRefusal('RAZORPAY_WEBHOOK_SECRET (staging value) required in env for replay')
  const order = await fetchOrder(client, args.order)
  if (!order) guardRefusal(`order ${args.order} not found`)
  if (order.currency !== 'INR' || order.gateway !== 'razorpay') guardRefusal(`order ${order.id} is ${order.gateway}/${order.currency} — replay tool is Razorpay/INR only`)

  const amountPaise = order.amountMinor ?? Math.round(order.amountInr * 100)
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: `pay_replay_${Date.now()}`, amount: amountPaise, currency: 'INR', status: 'captured', notes: { orderRef: order.id } } } },
  })
  const sig = (raw: string, key: string) => new Bun.CryptoHasher('sha256', key).update(raw).digest('hex')
  const post = async (rawBody: string, signature: string) =>
    fetchWithTimeout(`${args.frontendUrl}/api/razorpay/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': `evt-replay-${Date.now()}` },
      body: rawBody,
    })

  console.log(`WARNING: this sends a signed TEST-mode payment.captured for order ${order.id} — it fulfils the order WITHOUT real money. Test keys only.\n`)
  const first = await post(body, sig(body, secret))
  const second = await post(body, sig(body, secret))
  const tampered = await post(body, sig(body, `${secret}x`))
  const outbox = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "EmailOutbox" WHERE "orderId" = $1`, [order.id])

  const checks: Check[] = [
    first.status === 200 ? pass('replay-1', 'first replay accepted', `status 200`) : fail('replay-1', 'first replay accepted', `status ${first.status}`),
    second.status === 200 ? pass('replay-2', 'second replay answered', `status ${second.status} (duplicate:true expected)`) : fail('replay-2', 'second replay answered', `status ${second.status}`),
    tampered.status === 400 ? pass('tamper', 'tampered signature → 400', 'rejected') : fail('tamper', 'tampered signature → 400', `status ${tampered.status}`),
    Number(outbox.rows[0].n) === 1 ? pass('idempotent-email', 'still exactly one outbox row', `count=${outbox.rows[0].n}`) : fail('idempotent-email', 'still exactly one outbox row', `count=${outbox.rows[0].n}`),
  ]
  printCheckTable('razorpay webhook replay', checks)
  if (checks.some((c) => c.kind === 'fail')) process.exit(1)
}

// ── --paypal-replay + --lost-webhook ────────────────────────────
async function paypalReplay(client: Client): Promise<void> {
  console.log(`PayPal sandbox webhook replay — manual steps:
  1. developer.paypal.com → Events & notifications → find the PAYMENT.CAPTURE.COMPLETED for the sandbox payment
  2. "Resend event" twice — PayPal re-delivers with the SAME transmission id
  3. Expected: first 200 processed, second 200 {duplicate:true}; still one outbox row, one token.
  Then check idempotency in the database:
    order:        SELECT status, "downloadCount" FROM "Order" WHERE id = '<orderId>';
    outbox rows:  SELECT count(*) FROM "EmailOutbox" WHERE "orderId" = '<orderId>';   -- must be 1
  This script stays read-only; paste the counts into the staging checklist.`)
  const hb = await client.query<{ key: string; lastSuccessAt: Date }>(`SELECT key, "lastSuccessAt" FROM "CronHeartbeat" ORDER BY key`)
  console.log(`\ncron heartbeats observed: ${hb.rows.map((r) => `${r.key}@${r.lastSuccessAt.toISOString()}`).join(', ') || 'none'}`)
}

async function lostWebhook(args: AssistArgs, client: Client): Promise<void> {
  if (!args.order) guardRefusal('--lost-webhook needs --order <orderId>')
  const order = await fetchOrder(client, args.order)
  if (!order) guardRefusal(`order ${args.order} not found`)
  console.log(`Lost-webhook drill for ${order.id}:
  1. Temporarily disable the webhook endpoint in the Razorpay dashboard (or block /api/razorpay/webhook at the edge).
  2. Complete a test payment for this order.
  3. Within ~10 min the reconcile-payments cron must fulfil it WITHOUT the webhook.
  4. Re-enable the webhook endpoint. Now verifying the outcome…`)
  const checks: Check[] = []
  const hb = await client.query<{ key: string; age_min: number }>(`SELECT key, EXTRACT(epoch FROM (now() - "lastSuccessAt"))/60 AS age_min FROM "CronHeartbeat" WHERE key = 'reconcile-payments'`)
  const age = hb.rows[0]?.age_min
  checks.push(age !== undefined && age < 30 ? pass('heartbeat', 'reconcile heartbeat fresh (<30 min)', `${(age ?? 0).toFixed(1)} min`) : fail('heartbeat', 'reconcile heartbeat fresh (<30 min)', age === undefined ? 'no heartbeat row — cron never ran' : `${(age ?? 0).toFixed(1)} min — cron is not running`))
  const fresh = await fetchOrder(client, order.id)
  checks.push(fresh?.status === 'paid' ? pass('fulfilled', 'order fulfilled without webhook', `status=${fresh?.status}`) : fail('fulfilled', 'order fulfilled without webhook', `status=${fresh?.status}`))
  const outbox = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "EmailOutbox" WHERE "orderId" = $1 AND status = 'SENT'`, [order.id])
  checks.push(Number(outbox.rows[0].n) === 1 ? pass('emailed', 'delivery e-mail sent by cron path', 'one SENT row') : fail('emailed', 'delivery e-mail sent by cron path', `${outbox.rows[0].n} SENT row(s)`))
  printCheckTable('lost-webhook drill', checks)
  if (checks.some((c) => c.kind === 'fail')) process.exit(1)
}

async function main(): Promise<void> {
  const args = parseArgs()
  if (process.env.STAGING_CONFIRM !== 'yes') {
    guardRefusal('STAGING_CONFIRM=yes must be set — this tool drives staging payment flows.')
  }
  const posture = await stagingPosture(args.backendUrl)
  if (!posture.ok) {
    guardRefusal(`backend ${args.backendUrl} does not report a staging posture (demoMode=${posture.demoMode} testPaymentsAllowed=${posture.testPaymentsAllowed}) — refusing to touch what may be production.`)
  }
  if (args.mode === 'guided') {
    console.log('posture accepted — printing the manual matrix (no database or payment access needed)\n')
    return guided()
  }
  if (!args.dbUrl.startsWith('postgres')) {
    guardRefusal('DATABASE_URL must point at the STAGING database (read-only usage) — see docs/TESTING.md.')
  }
  const client = await readOnlyClient(args.dbUrl)
  try {
    if (args.mode === 'verify') return await verify(args)
    if (args.mode === 'replay-razorpay') return await replayRazorpay(args, client)
    if (args.mode === 'paypal-replay') return await paypalReplay(client)
    return await lostWebhook(args, client)
  } finally {
    await client.end().catch(() => undefined)
  }
}

main().catch((e: Error) => {
  console.error(`payments-sandbox-assist failed: ${e.message}`)
  process.exit(1)
})
