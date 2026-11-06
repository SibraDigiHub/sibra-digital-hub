// ═══════════════════════════════════════════════════════════
// T7 verification — security hardening gates (§8):
//   1. header checks (backend nosniff/no-referrer/cache-control,
//      frontend HSTS/nosniff/referrer/permissions/XFO/CSP-RO,
//      X-Powered-By absent, proxy chain intact)
//   2. robots.txt body
//   3. health booleans only
//   4. PG rate limits: live events beacon 429s + Retry-After +
//      RateLimit rows; in-process consume checks for the other
//      limiters; ALL test rows cleaned up afterwards
//   5. production boot-guard: env.ts refuses (missing/placeholder
//      secrets, demo/console modes without DEMO_MODE, EMAIL_API_URL,
//      non-postgres DATABASE_URL, weak INTERNAL_API_KEY) and boots
//      with DEMO_MODE=true + full secrets
// Run: bun scripts/t7-verify.ts   (servers must be up on 3000/3001)
// ═══════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../src/lib/db'

const HERE = dirname(fileURLToPath(import.meta.url))
const BE = 'http://localhost:3001'
const FE = 'http://localhost:3000'
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''

let pass = 0
let fail = 0
const results: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const b64_32 = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY' // 32 bytes base64

async function main() {
  // ── 1. Backend headers ─────────────────────────────────────
  {
    const res = await fetch(`${BE}/api/products`, { headers: { 'x-internal-key': INTERNAL_KEY } })
    check('be products 200', res.status === 200, String(res.status))
    check('be nosniff', res.headers.get('x-content-type-options') === 'nosniff')
    check('be no-referrer', res.headers.get('referrer-policy') === 'no-referrer')
    check(
      'be cache-control present (T3)',
      Boolean(res.headers.get('cache-control')),
      res.headers.get('cache-control') ?? '',
    )
  }
  {
    const res = await fetch(`${BE}/api/products`) // no key → guard 401 (headers still applied)
    check('be guard 401', res.status === 401)
    check('be 401 nosniff', res.headers.get('x-content-type-options') === 'nosniff')
    check('be 401 no-referrer', res.headers.get('referrer-policy') === 'no-referrer')
  }
  {
    const res = await fetch(`${BE}/api`)
    const body = (await res.json()) as Record<string, unknown>
    check('health 200', res.status === 200)
    check('health booleans only', Object.keys(body).sort().join(',') === 'db,demoMode,ok,testPaymentsAllowed' && body.ok === true && body.db === true && typeof body.demoMode === 'boolean' && typeof body.testPaymentsAllowed === 'boolean', JSON.stringify(body))
  }

  // ── 2. Frontend headers ────────────────────────────────────
  {
    const res = await fetch(FE)
    check('fe home 200', res.status === 200)
    check('fe HSTS', res.headers.get('strict-transport-security') === 'max-age=63072000; includeSubDomains', res.headers.get('strict-transport-security') ?? '')
    check('fe nosniff', res.headers.get('x-content-type-options') === 'nosniff')
    check('fe referrer strict-origin-when-cross-origin', res.headers.get('referrer-policy') === 'strict-origin-when-cross-origin')
    check(
      'fe permissions-policy',
      (res.headers.get('permissions-policy') ?? '') === 'camera=(), microphone=(), geolocation=(), payment=(self)',
      res.headers.get('permissions-policy') ?? '',
    )
    // X-Frame-Options: DENY ships on production builds only (next.config.ts);
    // dev relies on the CSP frame-ancestors 'none' (always present below).
    const xfo = res.headers.get('x-frame-options')
    check('fe X-Frame-Options DENY (prod builds only — dev may omit)', xfo === null || xfo === 'DENY', xfo ?? undefined)
    const csp = res.headers.get('content-security-policy-report-only') ?? ''
    check('fe CSP-Report-Only present', csp.startsWith("default-src 'self'"))
    check('fe CSP allows razorpay', csp.includes('https://*.razorpay.com'))
    check('fe CSP allows imagekit upload', csp.includes('https://upload.imagekit.io') && csp.includes('https://ik.imagekit.io'))
    check('fe CSP allows data:/blob:', csp.includes('data:') && csp.includes('blob:'))
    check('fe CSP style unsafe-inline', csp.includes("style-src 'self' 'unsafe-inline'"))
    check('fe CSP NO unsafe-eval', !csp.includes('unsafe-eval'))
    check('fe X-Powered-By absent', res.headers.get('x-powered-by') === null)
  }
  {
    const res = await fetch(`${FE}/api/products`) // proxy chain intact
    check('fe proxy /api/products 200', res.status === 200, String(res.status))
    check('fe proxied response carries backend nosniff', res.headers.get('x-content-type-options') === 'nosniff')
    const body = (await res.json()) as { products?: unknown[] }
    check('fe proxied body is products JSON', Array.isArray(body.products))
  }

  // ── 3. robots.txt ──────────────────────────────────────────
  {
    const res = await fetch(`${FE}/robots.txt`)
    const text = await res.text()
    check('robots 200', res.status === 200)
    check('robots disallow /admin', /Disallow:\s*\/admin\s*$/m.test(text))
    check('robots disallow /api', /Disallow:\s*\/api\s*$/m.test(text))
    check('robots allow /', /Allow:\s*\/\s*$/m.test(text))
  }

  // ── 4. Rate limits ─────────────────────────────────────────
  // 4a. live events beacon: 65 rapid POSTs → 60 accepted-ish, then 429s
  {
    const codes: number[] = []
    let retryAfter: string | null = null
    let blockedBody: Record<string, unknown> | null = null
    for (let i = 0; i < 65; i++) {
      const res = await fetch(`${BE}/api/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': INTERNAL_KEY,
          'x-forwarded-for': '203.0.113.7',
          'user-agent': 'T7Verify/1.0',
        },
        body: JSON.stringify({ type: 'contract_test', zone: 'kids' }),
      })
      codes.push(res.status)
      if (res.status === 429 && retryAfter === null) {
        retryAfter = res.headers.get('retry-after')
        blockedBody = (await res.json().catch(() => null)) as Record<string, unknown> | null
      } else {
        await res.arrayBuffer().catch(() => undefined)
      }
    }
    const okCount = codes.filter((c) => c === 204).length
    const blocked = codes.filter((c) => c === 429).length
    check('events: most accepted', okCount >= 58, `${okCount}×204`)
    check('events: over-limit 429', blocked >= 1, `${blocked}×429`)
    check('events: Retry-After header', Boolean(retryAfter), retryAfter ?? '')
    check('events: generic 429 body', blockedBody !== null && blockedBody.error === 'Too many requests, try again shortly.', JSON.stringify(blockedBody))
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "RateLimit" WHERE key LIKE 'events:ip:%'`,
    )
    check('events: PG RateLimit rows created', Number(rows[0]?.n ?? 0) >= 1, `${rows[0]?.n} rows`)
  }

  // 4b. in-process limiter checks (PG mechanics; no HTTP orders created)
  {
    const { ordersCreateLimitPerIp, downloadLimitPerIp, resendLimitPerIp, imagekitSignLimitPerIp } = await import(
      '../src/lib/auth/rate-limit'
    )
    const r1: Awaited<ReturnType<typeof ordersCreateLimitPerIp>>[] = []
    for (let i = 0; i < 11; i++) r1.push(await ordersCreateLimitPerIp('t7-orders-test'))
    check('orders create: 11th blocked (10/15min)', r1[9].allowed && !r1[10].allowed)
    const r2: Awaited<ReturnType<typeof downloadLimitPerIp>>[] = []
    for (let i = 0; i < 31; i++) r2.push(await downloadLimitPerIp('t7-download-test'))
    check('download: 31st blocked (30/min)', r2[29].allowed && !r2[30].allowed)
    const r3: Awaited<ReturnType<typeof resendLimitPerIp>>[] = []
    for (let i = 0; i < 11; i++) r3.push(await resendLimitPerIp('t7-resend-test'))
    check('resend: 11th blocked (10/hour)', r3[9].allowed && !r3[10].allowed)
    const r4: Awaited<ReturnType<typeof imagekitSignLimitPerIp>>[] = []
    for (let i = 0; i < 31; i++) r4.push(await imagekitSignLimitPerIp('t7-ik-test'))
    check('imagekit sign: 31st blocked (30/min)', r4[29].allowed && !r4[30].allowed)
    check('limiters expose Retry-After', r1[10].retryAfterSec > 0 && r2[30].retryAfterSec > 0)
  }

  // cleanup — remove every RateLimit row this script created
  {
    const del = await db.rateLimit.deleteMany({
      where: { OR: [{ key: { startsWith: 'events:ip:' } }, { key: { startsWith: 'orders:ip:' } }, { key: { startsWith: 'dl:ip:' } }, { key: { startsWith: 'resend:ip:' } }, { key: { startsWith: 'ik:ip:' } }] },
    })
    results.push(`CLEANUP RateLimit test rows deleted: ${del.count}`)
  }

  // ── 5. Production boot-guard (child processes, never this one) ──
  const good: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/sibra',
    ENCRYPTION_KEY: b64_32,
    SESSION_PEPPER: b64_32,
    PUBLIC_WEB_URL: 'https://example.com',
    INTERNAL_API_KEY: 't7-internal-key-0123456789abcdef',
    // the guard reads this straight from process.env — pin it so a dev
    // .env's ADMIN_REQUIRE_2FA=false cannot leak into the child.
    ADMIN_REQUIRE_2FA: 'true',
    // P4: CRON_SECRET is required in production (cron routes refuse
    // unauthenticated calls) — the boot-guard's positive cases need it.
    CRON_SECRET: 't7-cron-secret-0123456789abcdef',
    // Same hygiene for the demo escape hatch: the dev .env sets
    // DEMO_MODE=true, which would legitimately allow console email and
    // key-less Razorpay to BOOT in these "must refuse" cases. Pin it off
    // (the staging test below overrides it explicitly).
    DEMO_MODE: '',
  }
  async function bootGuard(extra: Record<string, string>): Promise<{ threw: boolean; msg: string }> {
    const proc = Bun.spawnSync(
      ['bun', '-e', `await import('${join(HERE, '../src/config/env.ts')}'); console.log('BOOTED OK')`],
      {
        cwd: join(HERE, '..'),
        env: { ...process.env, ...good, ...extra },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const msg = new TextDecoder().decode(proc.stderr) + new TextDecoder().decode(proc.stdout)
    return { threw: proc.exitCode !== 0, msg }
  }
  {
    const r = await bootGuard({})
    check('prod guard: console email (no RESEND_API_KEY) refuses', r.threw && r.msg.includes('console (demo) driver'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ EMAIL_PROVIDER: 'console', RESEND_API_KEY: 're_test_something' })
    check('prod guard: explicit EMAIL_PROVIDER=console refuses', r.threw && r.msg.includes('console (demo) driver'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ RESEND_API_KEY: 're_test_something' })
    check('prod guard: demo Razorpay (no keys) refuses', r.threw && r.msg.includes('demo mode'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ RESEND_API_KEY: 're_test_something', EMAIL_API_URL: 'http://127.0.0.1:9' })
    check('prod guard: EMAIL_API_URL refuses even with keys', r.threw && r.msg.includes('EMAIL_API_URL'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ RESEND_API_KEY: 're_test_something', INTERNAL_API_KEY: 'short' })
    check('prod guard: weak INTERNAL_API_KEY refuses', r.threw && r.msg.includes('INTERNAL_API_KEY'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ ...good, DATABASE_URL: 'file:./dev.db', RESEND_API_KEY: 're_test_something' })
    check('prod guard: non-postgres DATABASE_URL refuses', r.threw && r.msg.includes('PostgreSQL'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ RESEND_API_KEY: 're_x', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_MODE: 'live' })
    check('prod guard: razorpay mode/prefix mismatch refuses', r.threw && r.msg.includes('rzp_live_'), firstLine(r.msg))
  }
  {
    const r = await bootGuard({ DEMO_MODE: 'true' })
    check('prod guard: DEMO_MODE=true allows staging boot', !r.threw, firstLine(r.msg))
  }

  console.log(results.join('\n'))
  console.log(`\nT7 VERIFY: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
  process.exit(0)
}

function firstLine(s: string): string {
  const line = s
    .split('\n')
    .find((l) => /Refusing|Invalid environment|must be|must never|is not allowed|BOOTED/.test(l))
  return (line ?? s.split('\n')[0]).trim().slice(0, 160)
}

main().catch((e) => {
  console.error('t7-verify error:', e)
  process.exit(1)
})
