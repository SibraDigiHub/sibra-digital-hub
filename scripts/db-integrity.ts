// ═══════════════════════════════════════════════════════════
// db-integrity.ts — READ-ONLY data integrity checker (SELECT only).
//
//   DATABASE_URL=… bun scripts/db-integrity.ts [--since 24h] [--json]
//   DATABASE_URL=… bun scripts/db-integrity.ts --db postgresql://…
//
// Safe to run against production — every statement is a static
// SELECT; no DDL/DML exists in this file. Output prints counts and
// sample IDS only (never e-mails, tokens or hashes). Exit code is
// non-zero when a CRITICAL invariant fails. Recommended production
// usage: a read-only database role (docs/TESTING.md §db-integrity).
// ═══════════════════════════════════════════════════════════

import { Client } from 'pg'

type Severity = 'CRITICAL' | 'WARN' | 'OK'
interface Row {
  id: string
  severity: Severity
  invariant: string
  detail: string
  samples: string[]
}

interface Args {
  dbUrl: string
  sinceHours: number
  json: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i > -1 ? argv[i + 1] : undefined
  }
  const dbUrl = get('--db') ?? process.env.DATABASE_URL
  if (!dbUrl || !(dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    console.error('db-integrity: a postgres:// DATABASE_URL (or --db <url>) is required — see docs/TESTING.md.')
    process.exit(1)
  }
  const sinceRaw = get('--since') ?? '720h'
  const sinceMatch = /^(\d+)h$/.exec(sinceRaw)
  const sinceHours = sinceMatch ? Number(sinceMatch[1]) : 720
  return { dbUrl, sinceHours, json: argv.includes('--json') }
}

// Consent columns arrived with migration 20261029122737_p1_consent_p4_cron_heartbeat.
const CONSENT_SINCE = '2026-10-29T12:27:37Z'
// Dual-gateway columns (amountMinor etc.) arrived with 20261029120000_payment_dual_gateway.
const MINOR_SINCE = '2026-10-29T12:00:00Z'

interface Query {
  id: string
  invariant: string
  /** Returns detail text and sample ids; empty samples ⇒ invariant holds. */
  sql: string
  sampleIdColumn: string
  critical: boolean
}

function queries(sinceHours: number): Query[] {
  const since = `now() - interval '${sinceHours} hours'`
  return [
    {
      id: 'paid-missing-delivery-secrets',
      invariant: 'PAID file-orders have token hash, expiry and a gateway payment/capture id',
      sql: `SELECT o.id FROM "Order" o JOIN "Product" p ON p.id = o."productId"
            WHERE o.status = 'paid' AND p."deliveryMode" <> 'watch'
              AND (o."downloadTokenHash" IS NULL OR o."tokenExpiresAt" IS NULL
                   OR (o."razorpayPaymentId" IS NULL AND o."paypalCaptureId" IS NULL))
            LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'watch-missing-grant',
      invariant: 'PAID watch-orders have a WatchGrant',
      sql: `SELECT o.id FROM "Order" o JOIN "Product" p ON p.id = o."productId"
            WHERE o.status = 'paid' AND p."deliveryMode" = 'watch'
              AND NOT EXISTS (SELECT 1 FROM "WatchGrant" w WHERE w."orderId" = o.id)
            LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'duplicate-gateway-ids',
      invariant: 'no duplicate gateway order/payment/capture ids',
      sql: `SELECT 'razorpayPaymentId:' || COALESCE("razorpayPaymentId",'null') AS id FROM "Order" WHERE "razorpayPaymentId" IS NOT NULL GROUP BY "razorpayPaymentId" HAVING count(*) > 1
            UNION ALL SELECT 'paypalOrderId:' || COALESCE("paypalOrderId",'null') FROM "Order" WHERE "paypalOrderId" IS NOT NULL GROUP BY "paypalOrderId" HAVING count(*) > 1
            UNION ALL SELECT 'paypalCaptureId:' || COALESCE("paypalCaptureId",'null') FROM "Order" WHERE "paypalCaptureId" IS NOT NULL GROUP BY "paypalCaptureId" HAVING count(*) > 1
            LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'amounts',
      invariant: 'no zero/negative amounts on paid orders',
      sql: `SELECT id FROM "Order"
            WHERE status = 'paid' AND ("amountInr" <= 0 OR ("amountMinor" IS NOT NULL AND "amountMinor" <= 0))
            LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'paid-missing-amount-minor',
      invariant: 'PAID orders created after the dual-gateway migration carry amountMinor',
      sql: `SELECT id FROM "Order" WHERE status = 'paid' AND "amountMinor" IS NULL AND "createdAt" >= '${MINOR_SINCE}' LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'gateway-currency-routing',
      invariant: 'gateway/currency pairs obey routing (IN ⇒ razorpay/INR, else paypal/USD)',
      sql: `SELECT id FROM "Order"
            WHERE status IN ('paid','pending')
              AND ( ("gateway" = 'razorpay' AND "currency" <> 'INR')
                 OR ("gateway" = 'paypal'   AND "currency" <> 'USD')
                 OR ("billingCountry" = 'IN' AND "gateway" <> 'razorpay') )
            LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'consent-at',
      invariant: `orders created after consent migration (${CONSENT_SINCE}) store consentAt`,
      sql: `SELECT id FROM "Order" WHERE "createdAt" >= '${CONSENT_SINCE}' AND "consentAt" IS NULL AND status <> 'failed' LIMIT 50`,
      sampleIdColumn: 'id',
      critical: false,
    },
    {
      id: 'stale-pending',
      invariant: `no PENDING orders older than 24 h (window: last ${sinceHours} h)`,
      sql: `SELECT id FROM "Order" WHERE status = 'pending' AND "createdAt" < now() - interval '24 hours' AND "createdAt" >= ${since} LIMIT 50`,
      sampleIdColumn: 'id',
      critical: false,
    },
    {
      id: 'paid-not-emailed',
      invariant: 'PAID orders older than 15 min have a SENT delivery outbox row',
      sql: `SELECT o.id FROM "Order" o
            WHERE o.status = 'paid' AND o."createdAt" < now() - interval '15 minutes' AND o."createdAt" >= ${since}
              AND NOT EXISTS (SELECT 1 FROM "EmailOutbox" ob WHERE ob."orderId" = o.id AND ob.status = 'SENT')
            LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'outbox-failed',
      invariant: 'no FAILED outbox rows (delivery retries exhausted)',
      sql: `SELECT id FROM "EmailOutbox" WHERE status = 'FAILED' AND "createdAt" >= ${since} LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'paid-but-not-delivered',
      invariant: 'no PAID_BUT_NOT_DELIVERED risk flags',
      sql: `SELECT id FROM "Order" WHERE "riskFlags" @> ARRAY['PAID_BUT_NOT_DELIVERED']::text[] AND "createdAt" >= ${since} LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'failed-webhook-events',
      invariant: 'no failed webhook events',
      sql: `SELECT id FROM "WebhookEvent" WHERE result IN ('failed','mismatch','rejected') AND "processedAt" >= ${since} LIMIT 50`,
      sampleIdColumn: 'id',
      critical: true,
    },
    {
      id: 'unmatched-webhook-events',
      invariant: 'no unmatched webhook events (webhook for an unknown order)',
      sql: `SELECT id FROM "WebhookEvent" WHERE result = 'unmatched' AND "processedAt" >= ${since} LIMIT 50`,
      sampleIdColumn: 'id',
      critical: false,
    },
  ]
}

interface Extra {
  id: string
  label: string
  critical: boolean
  run: (c: Client) => Promise<string>
}

function extras(): Extra[] {
  return [
    {
      id: 'cron-heartbeats',
      label: 'cron heartbeats fresh (warn > 30 min, critical > 2 h)',
      critical: true,
      run: async (c) => {
        const { rows } = await c.query<{ key: string; age_min: number | null }>(
          `SELECT key, EXTRACT(epoch FROM (now() - "lastSuccessAt")) / 60 AS age_min FROM "CronHeartbeat"`,
        )
        if (rows.length === 0) return 'WARN: no heartbeat rows — crons have never succeeded here (expected on a fresh dev DB)'
        const stale = rows.filter((r) => (r.age_min ?? Infinity) > 30)
        const dead = rows.filter((r) => (r.age_min ?? Infinity) > 120)
        if (dead.length > 0) return `CRITICAL: ${dead.map((r) => `${r.key} ${(r.age_min ?? 0).toFixed(0)}min`).join(', ')}`
        if (stale.length > 0) return `WARN: stale >30min — ${stale.map((r) => `${r.key} ${(r.age_min ?? 0).toFixed(0)}min`).join(', ')}`
        return `OK — ${rows.map((r) => `${r.key} ${(r.age_min ?? 0).toFixed(1)}min`).join(', ')}`
      },
    },
    {
      id: 'expired-sessions',
      label: 'expired admin sessions not purged',
      critical: false,
      run: async (c) => {
        const { rows } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "AdminSession" WHERE "expiresAt" < now() AND "revokedAt" IS NULL`)
        return Number(rows[0].n) > 0 ? `WARN: ${rows[0].n} expired session(s) still present (reconcile cron prunes them)` : 'OK — none'
      },
    },
    {
      id: 'stale-rate-limits',
      label: 'stale rate-limit rows not purged',
      critical: false,
      run: async (c) => {
        const { rows } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "RateLimit" WHERE "resetAt" < now()`)
        return Number(rows[0].n) > 0 ? `WARN: ${rows[0].n} stale row(s) (pruned by reconcile-payments within 24 h)` : 'OK — none'
      },
    },
    {
      id: 'risk-flag-summary',
      label: 'riskFlags summary (all orders)',
      critical: false,
      run: async (c) => {
        const { rows } = await c.query<{ flag: string; n: string }>(
          `SELECT flag, count(*)::text AS n FROM "Order", unnest("riskFlags") AS flag GROUP BY flag ORDER BY n DESC`,
        )
        return rows.length === 0 ? 'OK — no risk flags anywhere' : rows.map((r) => `${r.flag}×${r.n}`).join(', ')
      },
    },
    {
      id: 'outbox-pending-age',
      label: 'oldest PENDING outbox row age',
      critical: false,
      run: async (c) => {
        const { rows } = await c.query<{ age_min: number | null }>(
          `SELECT EXTRACT(epoch FROM (now() - MIN("createdAt"))) / 60 AS age_min FROM "EmailOutbox" WHERE status = 'PENDING'`,
        )
        const age = rows[0]?.age_min
        return age === null || age === undefined ? 'OK — nothing pending' : `INFO: oldest pending = ${age.toFixed(1)} min`
      },
    },
  ]
}

function severityOf(q: Query, samples: string[]): Severity {
  if (samples.length === 0) return 'OK'
  return q.critical ? 'CRITICAL' : 'WARN'
}

async function main(): Promise<void> {
  const args = parseArgs()
  const client = new Client({
    connectionString: args.dbUrl,
    // read-only belt-and-braces: even a bug in this file cannot write
    options: '-c default_transaction_read_only=on',
  })
  await client.connect()

  const rows: Row[] = []
  for (const q of queries(args.sinceHours)) {
    const res = await client.query<Record<string, string>>(q.sql)
    const samples = res.rows.map((r) => String(r[q.sampleIdColumn])).slice(0, 5)
    rows.push({
      id: q.id,
      severity: severityOf(q, samples),
      invariant: q.invariant,
      detail: samples.length === 0 ? 'holds' : `${res.rowCount} row(s) violate`,
      samples,
    })
  }
  for (const extra of extras()) {
    const detail = await extra.run(client)
    const severity = detail.startsWith('CRITICAL') ? 'CRITICAL' : detail.startsWith('WARN') ? 'WARN' : 'OK'
    rows.push({ id: extra.id, severity, invariant: extra.label, detail, samples: [] })
  }

  const orderCounts = await client.query<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM "Order" GROUP BY status ORDER BY n DESC`)
  await client.end()

  if (args.json) {
    console.log(JSON.stringify({ orders: orderCounts.rows, checks: rows }, null, 2))
  } else {
    console.log(`\ndb-integrity — orders: ${orderCounts.rows.map((r) => `${r.status}=${r.n}`).join(' ')} (window: last ${args.sinceHours} h unless stated)`)
    for (const r of rows) {
      const tag = r.severity.padEnd(8)
      const sampleTxt = r.samples.length > 0 ? ` samples: ${r.samples.join(', ')}` : ''
      console.log(`${tag} ${r.invariant}\n${' '.repeat(9)}→ ${r.detail}${sampleTxt}`)
    }
  }
  const critical = rows.filter((r) => r.severity === 'CRITICAL')
  if (critical.length > 0) {
    console.error(`\ndb-integrity: FAIL — ${critical.length} critical invariant(s): ${critical.map((r) => r.id).join(', ')}`)
    process.exit(1)
  }
  console.log('\ndb-integrity: PASS — no critical invariants violated')
}

main().catch((e: Error) => {
  console.error(`db-integrity failed: ${e.message}`)
  process.exit(1)
})
