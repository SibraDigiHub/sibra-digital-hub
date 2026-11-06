// ═══════════════════════════════════════════════════════════
// Single-gateway Razorpay — UNIT tests (§12.1): resolveGateway table,
// currency exponents, money helpers, signature verification, token
// hashing/TTL, env boot guards. No DB, no network.
// Run: DATABASE_URL=… bun test tests/payments/unit.test.ts
// ═══════════════════════════════════════════════════════════
import { afterAll, describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import { resolveGateway, normalizeCountry, type RoutableProduct } from '@/services/gateway-routing'
import { toMinor, formatMinor } from '@/lib/money'
import { verifyCheckoutSignature, verifyWebhookSignature, toCurrencyMinor, currencyExponentFactor } from '@/lib/razorpay'
import { generateToken, hashToken } from '@/lib/delivery'
import { testPaymentFulfillmentBlocked, razorpayBlockedCountries, internationalCheckoutEnabled } from '@/config/env'

const product: RoutableProduct = {
  instantDownload: true,
  priceInr: 499,
  priceUsd: 5.99,
  deliverableUrl: 'ik:files/demo.pdf',
  fullVideoUrl: null,
  deliveryMode: 'file',
}
const enabled = { razorpayEnabled: true }

// INTERNATIONAL_CHECKOUT_ENABLED default false — the international routing
// tests opt in explicitly and the flag is restored afterAll.
const savedFlag = process.env.INTERNATIONAL_CHECKOUT_ENABLED
afterAll(() => {
  if (savedFlag === undefined) delete process.env.INTERNATIONAL_CHECKOUT_ENABLED
  else process.env.INTERNATIONAL_CHECKOUT_ENABLED = savedFlag
})

function enableInternational(): void {
  process.env.INTERNATIONAL_CHECKOUT_ENABLED = 'true'
}

// ── resolveGateway table (§6) ─────────────────────────────
describe('resolveGateway', () => {
  test('India → Razorpay / INR / priceInr minor units', () => {
    const d = resolveGateway('IN', product, enabled)
    expect(d).toEqual({ ok: true, gateway: 'razorpay', currency: 'INR', amountMinor: 49900 })
  })

  test('international countries → Razorpay / USD / priceUsd minor units (flag on)', () => {
    enableInternational()
    for (const c of ['US', 'GB', 'AE', 'AU', 'DE']) {
      const d = resolveGateway(c, product, enabled)
      expect(d).toEqual({ ok: true, gateway: 'razorpay', currency: 'USD', amountMinor: 599 })
    }
  })

  test('international flag OFF → INTERNATIONAL_DISABLED (marketplace fallback)', () => {
    process.env.INTERNATIONAL_CHECKOUT_ENABLED = 'false'
    const d = resolveGateway('US', product, enabled)
    expect(d.ok).toBeFalse()
    if (!d.ok) expect(d.rejection).toBe('INTERNATIONAL_DISABLED')
  })

  test('a configured non-USD currency has no price source yet → NO_FOREIGN_PRICE (never a conversion)', () => {
    enableInternational()
    process.env.RAZORPAY_FOREIGN_CURRENCIES = 'EUR'
    try {
      const d = resolveGateway('DE', product, enabled)
      expect(d.ok).toBeFalse()
      if (!d.ok) expect(d.rejection).toBe('NO_FOREIGN_PRICE')
    } finally {
      delete process.env.RAZORPAY_FOREIGN_CURRENCIES
    }
  })

  test('missing USD price → friendly rejection (no conversion)', () => {
    enableInternational()
    const d = resolveGateway('US', { ...product, priceUsd: 0 }, enabled)
    expect(d.ok).toBeFalse()
    if (!d.ok) expect(d.rejection).toBe('NO_USD_PRICE')
  })

  test('missing INR price for India → NO_INR_PRICE', () => {
    const d = resolveGateway('IN', { ...product, priceInr: 0 }, enabled)
    expect(d.ok).toBeFalse()
    if (!d.ok) expect(d.rejection).toBe('NO_INR_PRICE')
  })

  test('blocked country → COUNTRY_BLOCKED', () => {
    enableInternational()
    process.env.RAZORPAY_BLOCKED_COUNTRIES = 'PK'
    try {
      const d = resolveGateway('PK', product, enabled)
      expect(d.ok).toBeFalse()
      if (!d.ok) expect(d.rejection).toBe('COUNTRY_BLOCKED')
    } finally {
      delete process.env.RAZORPAY_BLOCKED_COUNTRIES
    }
  })

  test('legacy PAYPAL_BLOCKED_COUNTRIES alias still blocks', () => {
    enableInternational()
    process.env.PAYPAL_BLOCKED_COUNTRIES = 'KP'
    try {
      const d = resolveGateway('KP', product, enabled)
      expect(d.ok).toBeFalse()
      if (!d.ok) expect(d.rejection).toBe('COUNTRY_BLOCKED')
    } finally {
      delete process.env.PAYPAL_BLOCKED_COUNTRIES
    }
  })

  test('disabled gateway → GATEWAY_DISABLED', () => {
    enableInternational()
    const d = resolveGateway('US', product, { razorpayEnabled: false })
    expect(d.ok).toBeFalse()
    if (!d.ok) expect(d.rejection).toBe('GATEWAY_DISABLED')
  })

  test('instant download off → PRODUCT_NOT_INSTANT', () => {
    const d = resolveGateway('US', { ...product, instantDownload: false }, enabled)
    expect(d.ok).toBeFalse()
    if (!d.ok) expect(d.rejection).toBe('PRODUCT_NOT_INSTANT')
  })

  test('null country → COUNTRY_BLOCKED (ask for confirmation, never guess)', () => {
    const d = resolveGateway(null, product, enabled)
    expect(d.ok).toBeFalse()
    if (!d.ok) expect(d.rejection).toBe('COUNTRY_BLOCKED')
  })

  test('the international flag helper reads the env strictly', () => {
    process.env.INTERNATIONAL_CHECKOUT_ENABLED = 'true'
    expect(internationalCheckoutEnabled()).toBeTrue()
    process.env.INTERNATIONAL_CHECKOUT_ENABLED = '1'
    expect(internationalCheckoutEnabled()).toBeTrue()
    process.env.INTERNATIONAL_CHECKOUT_ENABLED = 'TRUE'
    expect(internationalCheckoutEnabled()).toBeFalse()
    delete process.env.INTERNATIONAL_CHECKOUT_ENABLED
    expect(internationalCheckoutEnabled()).toBeFalse()
  })
})

describe('normalizeCountry', () => {
  test('uppercases and validates', () => {
    expect(normalizeCountry('in')).toBe('IN')
    expect(normalizeCountry(' USA ')).toBeNull()
    expect(normalizeCountry('')).toBeNull()
    expect(normalizeCountry(null)).toBeNull()
  })
})

// ── money helpers (§4: integer minor units everywhere) ──────
describe('money helpers', () => {
  test('toMinor half-up rounding', () => {
    expect(toMinor(499)).toBe(49900)
    expect(toMinor(5.99)).toBe(599)
    expect(toMinor(5.995)).toBe(600)
    expect(toMinor(0)).toBeNull()
    expect(toMinor(-3)).toBeNull()
    expect(toMinor(Number.NaN)).toBeNull()
  })

  test('currency exponents — two decimals for INR/USD, never assumed for others', () => {
    expect(currencyExponentFactor('INR')).toBe(100)
    expect(currencyExponentFactor('USD')).toBe(100)
    expect(toCurrencyMinor(499, 'INR')).toBe(49900)
    expect(toCurrencyMinor(5.99, 'USD')).toBe(599)
    expect(currencyExponentFactor('JPY')).toBe(1)
    expect(toCurrencyMinor(499, 'JPY')).toBe(499)
    expect(currencyExponentFactor('KWD')).toBe(1000)
    expect(toCurrencyMinor(5.995, 'KWD')).toBe(5995)
    expect(currencyExponentFactor('XYZ')).toBeNull()
    expect(toCurrencyMinor(10, 'XYZ')).toBeNull()
    expect(toCurrencyMinor(0, 'USD')).toBeNull()
    expect(toCurrencyMinor(Number.NaN, 'USD')).toBeNull()
  })

  test('display formatting', () => {
    expect(formatMinor(49900, 'INR')).toBe('₹499')
    expect(formatMinor(599, 'USD')).toBe('$5.99')
  })
})

// ── signature verification (§10.2) ─────────────────────────
describe('razorpay signatures', () => {
  const KEY = 'test_key_secret_for_suite'
  const hmac = (payload: string, secret: string) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex')

  test('payment signature accepts the valid HMAC, rejects tampered / wrong secret / bad length', () => {
    // Save/restore (NOT delete) — bun runs test files in one process, and a
    // deleted var here silently broke later suites that read the real value.
    const saved = process.env.RAZORPAY_KEY_SECRET
    process.env.RAZORPAY_KEY_SECRET = KEY
    try {
      const sig = hmac('order_X|pay_Y', KEY)
      expect(verifyCheckoutSignature('order_X', 'pay_Y', sig)).toBeTrue()
      expect(verifyCheckoutSignature('order_X', 'pay_Y', sig.slice(0, -2) + 'ff')).toBeFalse()
      expect(verifyCheckoutSignature('order_X', 'pay_Y', hmac('order_X|pay_Y', 'wrong'))).toBeFalse()
      expect(verifyCheckoutSignature('order_X', 'pay_Y', 'deadbeef')).toBeFalse()
      expect(verifyCheckoutSignature('order_X', 'pay_Y', null)).toBeFalse()
    } finally {
      if (saved === undefined) delete process.env.RAZORPAY_KEY_SECRET
      else process.env.RAZORPAY_KEY_SECRET = saved
    }
  })

  test('webhook signature verifies the RAW body', () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'
    try {
      const body = '{"event":"payment.captured"}'
      expect(verifyWebhookSignature(body, hmac(body, 'whsec'))).toBeTrue()
      expect(verifyWebhookSignature(body + ' ', hmac(body, 'whsec'))).toBeFalse()
      expect(verifyWebhookSignature(body, null)).toBeFalse()
    } finally {
      if (saved === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET
      else process.env.RAZORPAY_WEBHOOK_SECRET = saved
    }
  })
})

// ── tokens (§7: 32 random bytes, SHA-256 stored) ────────────
describe('download tokens', () => {
  test('hash is the sha256 of the plain token; TTL honours the env default', () => {
    const { plain, hash, expiresAt } = generateToken()
    expect(hashToken(plain)).toBe(hash)
    expect(plain.length).toBeGreaterThanOrEqual(40)
    const ttlHours = Number(process.env.DOWNLOAD_TTL_HOURS ?? 48)
    const expected = Date.now() + ttlHours * 3600 * 1000
    expect(Math.abs(expiresAt.getTime() - expected)).toBeLessThan(5000)
  })

  test('two tokens never collide', () => {
    expect(generateToken().plain).not.toBe(generateToken().plain)
  })
})

// ── env boot guards (§10.6) ────────────────────────────────
describe('env guards', () => {
  // Next's types mark NODE_ENV readonly; the runtime property is writable.
  const setEnv = (k: string, v: string | undefined): void => {
    (process.env as Record<string, string | undefined>)[k] = v
  }

  const SAVED: Record<string, string | undefined> = {}
  const KEYS = ['NODE_ENV', 'RAZORPAY_MODE', 'ALLOW_TEST_PAYMENTS_IN_PRODUCTION', 'RAZORPAY_BLOCKED_COUNTRIES', 'PAYPAL_BLOCKED_COUNTRIES']
  for (const k of KEYS) SAVED[k] = process.env[k]

  test('sandbox fulfilment blocked in production without the override', () => {
    setEnv('NODE_ENV', 'production')
    process.env.RAZORPAY_MODE = 'test'
    process.env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION = ''
    expect(testPaymentFulfillmentBlocked()).toBeTrue()
    process.env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION = 'true'
    expect(testPaymentFulfillmentBlocked()).toBeFalse()
  })

  test('international flag OFF by default; helper reads the strict parse', () => {
    // (covered in the resolveGateway suite) — here: env guard for the API-base override.
  })

  test('dev never blocks', () => {
    setEnv('NODE_ENV', 'development')
    process.env.RAZORPAY_MODE = 'test'
    expect(testPaymentFulfillmentBlocked()).toBeFalse()
  })

  test('RAZORPAY_BLOCKED_COUNTRIES parses to an uppercase set (legacy alias honoured)', () => {
    process.env.RAZORPAY_BLOCKED_COUNTRIES = 'pk, NG ,us'
    expect(razorpayBlockedCountries()).toEqual(new Set(['PK', 'NG', 'US']))
    delete process.env.RAZORPAY_BLOCKED_COUNTRIES
    process.env.PAYPAL_BLOCKED_COUNTRIES = 'kp'
    expect(razorpayBlockedCountries()).toEqual(new Set(['KP']))
    delete process.env.PAYPAL_BLOCKED_COUNTRIES
    expect(razorpayBlockedCountries()).toEqual(new Set())
  })

  afterAll(() => {
    // Restore everything the guard tests mutated — later files in the same
    // process read the real environment.
    for (const k of KEYS) {
      if (SAVED[k] === undefined) delete (process.env as Record<string, string | undefined>)[k]
      else (process.env as Record<string, string | undefined>)[k] = SAVED[k]
    }
  })
})

// ── Security audit: constant-time secret comparison ─────────
describe('secretsEqual (timing-safe guard)', () => {
  test('accepts exact matches and rejects everything else without throwing', async () => {
    const { secretsEqual } = await import('@/lib/timing-safe')
    expect(secretsEqual('abc', 'abc')).toBeTrue()
    expect(secretsEqual('', '')).toBeTrue()
    expect(secretsEqual('abc', 'abd')).toBeFalse()
    expect(secretsEqual('abc', 'ab')).toBeFalse()
    expect(secretsEqual('abc', 'abcd')).toBeFalse()
    expect(secretsEqual('', 'x')).toBeFalse()
    expect(secretsEqual('a\u0000b', 'a\u0000b')).toBeTrue()
  })
})

// ── Re-audit B5: amountMinor is the authoritative billed paise ──
describe('orderExpectedMinor (integer minor units authoritative)', () => {
  test('uses the integer amountMinor snapshot when present', async () => {
    const { orderExpectedMinor } = await import('@/lib/money')
    // Float artifact deliberately diverges from the integer snapshot.
    expect(orderExpectedMinor({ amountMinor: 599, amountInr: 5.955 })).toBe(599)
    expect(orderExpectedMinor({ amountMinor: 49900, amountInr: 499 })).toBe(49900)
  })

  test('falls back to the legacy Float snapshot for pre-dual-payment rows', async () => {
    const { orderExpectedMinor } = await import('@/lib/money')
    expect(orderExpectedMinor({ amountMinor: null, amountInr: 499 })).toBe(49900)
    expect(orderExpectedMinor({ amountMinor: null, amountInr: 5.99 })).toBe(599)
  })
})

// ── Re-audit B2: webhook secrets are required in production ──
describe('webhookSecretFailures (production boot guard)', () => {
  test('Razorpay keys without RAZORPAY_WEBHOOK_SECRET fail closed', async () => {
    const { webhookSecretFailures } = await import('@/config/env')
    const failures = webhookSecretFailures({ RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's' })
    expect(failures.some((f) => f.includes('RAZORPAY_WEBHOOK_SECRET'))).toBeTrue()
    expect(webhookSecretFailures({ RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' })).toEqual([])
    // No keys ⇒ no requirement (key-less demo environments).
    expect(webhookSecretFailures({})).toEqual([])
  })

  test('RAZORPAY_API_BASE is a test-only override — production boot refuses it', async () => {
    const { productionFailures } = await import('@/config/env')
    const base = {
      ENCRYPTION_KEY: Buffer.from('k'.repeat(32), 'utf8').toString('base64'),
      SESSION_PEPPER: Buffer.from('p'.repeat(32), 'utf8').toString('base64'),
      PUBLIC_WEB_URL: 'https://sibra.example',
      INTERNAL_API_KEY: 'x'.repeat(20),
      CRON_SECRET: 'cron',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 's',
      RAZORPAY_WEBHOOK_SECRET: 'w',
      RESEND_API_KEY: 're_x',
    }
    expect(productionFailures({ ...base, RAZORPAY_API_BASE: 'http://127.0.0.1:3010' }).some((f) => f.includes('RAZORPAY_API_BASE'))).toBeTrue()
    expect(productionFailures({ ...base }).some((f) => f.includes('RAZORPAY_API_BASE'))).toBeFalse()
  })
})

// ── Re-audit B2: demo/mock route visibility gate ────────────
describe('demoRouteBlocked (mock payment routes in production)', () => {
  const savedDemo = process.env.DEMO_MODE
  afterAll(() => {
    // The dev .env sets DEMO_MODE=true — restore whatever this process had.
    if (savedDemo === undefined) delete process.env.DEMO_MODE
    else process.env.DEMO_MODE = savedDemo
  })

  test('real production hides the mock routes', async () => {
    const { demoRouteBlocked } = await import('@/config/env')
    process.env.DEMO_MODE = ''
    expect(demoRouteBlocked('production')).toBeTrue()
  })

  test('an explicit DEMO_MODE staging deployment keeps them (documented escape hatch)', async () => {
    const { demoRouteBlocked } = await import('@/config/env')
    process.env.DEMO_MODE = 'true'
    expect(demoRouteBlocked('production')).toBeFalse()
    process.env.DEMO_MODE = '1'
    expect(demoRouteBlocked('production')).toBeFalse()
    process.env.DEMO_MODE = 'TRUE' // strict parse — typos can never weaken the guard
    expect(demoRouteBlocked('production')).toBeTrue()
  })

  test('non-production never blocks', async () => {
    const { demoRouteBlocked } = await import('@/config/env')
    process.env.DEMO_MODE = ''
    expect(demoRouteBlocked('development')).toBeFalse()
    expect(demoRouteBlocked('test')).toBeFalse()
    expect(demoRouteBlocked(undefined)).toBeFalse()
  })
})

// ═══════════════════════════════════════════════════════════
// Payment-audit fixes (this audit) — unit-level guards.
// ═══════════════════════════════════════════════════════════

describe('escapeHtml (delivery email injection guard)', () => {
  test('escapes markup and entities in user-controlled text', async () => {
    const { escapeHtml } = await import('@/lib/email')
    expect(escapeHtml('<b>Bold</b> & "quoted" \'single\'')).toBe(
      '&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot; &#39;single&#39;',
    )
    expect(escapeHtml('plain name')).toBe('plain name')
    expect(escapeHtml('')).toBe('')
  })
})

describe('clientIp (rate-limit key must not be browser-forgeable)', () => {
  // The audit finding: the previous implementation trusted the FIRST
  // x-forwarded-for hop — a value any browser can set — so every
  // IP-keyed rate limit and audit hash could be rotated at will.
  function reqWith(headers: Record<string, string>): Request {
    return new Request('http://backend.local/api/test', { headers })
  }

  test('x-client-ip (set by our own proxy) wins over a spoofed XFF first hop', async () => {
    const { clientIp } = await import('@/lib/auth/session')
    const req = reqWith({ 'x-client-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })
    expect(clientIp(req)).toBe('203.0.113.9')
  })

  test('without x-client-ip the LAST XFF hop (appended by our edge) is used', async () => {
    const { clientIp } = await import('@/lib/auth/session')
    expect(clientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIp(reqWith({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  test('falls back to x-real-ip then unknown; garbage XFF never wins the first hop', async () => {
    const { clientIp } = await import('@/lib/auth/session')
    expect(clientIp(reqWith({ 'x-real-ip': '192.0.2.5' }))).toBe('192.0.2.5')
    expect(clientIp(reqWith({}))).toBe('unknown')
  })

  test('admin-session clientIp shares the same contract', async () => {
    const { clientIp } = await import('@/lib/admin-session')
    expect(clientIp(reqWith({ 'x-client-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('203.0.113.9')
    expect(clientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }))).toBe('198.51.100.7')
  })
})

// ═══════════════════════════════════════════════════════════
// Payment fixes P1–P6 — unit-level guards (pure functions).
// ═══════════════════════════════════════════════════════════

describe('P1: legacy POST /api/orders guard', () => {
  const setEnv = (k: string, v: string | undefined): void => {
    (process.env as Record<string, string | undefined>)[k] = v
  }
  const SAVED: Record<string, string | undefined> = {}
  const KEYS = ['NODE_ENV', 'LEGACY_ORDERS_ENABLED']
  for (const k of KEYS) SAVED[k] = process.env[k]

  test('production refuses even with LEGACY_ORDERS_ENABLED=true', async () => {
    const { legacyOrdersEnabled } = await import('@/config/env')
    setEnv('NODE_ENV', 'production')
    setEnv('LEGACY_ORDERS_ENABLED', 'true')
    expect(legacyOrdersEnabled()).toBeFalse()
  })

  test('dev defaults to retired (410); only the explicit opt-in revives it', async () => {
    const { legacyOrdersEnabled } = await import('@/config/env')
    setEnv('NODE_ENV', 'development')
    setEnv('LEGACY_ORDERS_ENABLED', undefined)
    expect(legacyOrdersEnabled()).toBeFalse()
    setEnv('LEGACY_ORDERS_ENABLED', 'true')
    expect(legacyOrdersEnabled()).toBeTrue()
    setEnv('LEGACY_ORDERS_ENABLED', '1')
    expect(legacyOrdersEnabled()).toBeTrue()
    setEnv('LEGACY_ORDERS_ENABLED', 'TRUE') // strict parse — typos cannot widen the gate
    expect(legacyOrdersEnabled()).toBeFalse()
  })

  afterAll(() => {
    for (const k of KEYS) {
      if (SAVED[k] === undefined) delete (process.env as Record<string, string | undefined>)[k]
      else (process.env as Record<string, string | undefined>)[k] = SAVED[k]
    }
  })
})

describe('P2: boot guards', () => {
  test('mockModeWarnings lists exactly the active mock flags (strict parsing)', async () => {
    const { mockModeWarnings } = await import('@/config/env')
    expect(mockModeWarnings({})).toEqual([])
    expect(
      mockModeWarnings({ DEMO_MODE: 'true', ALLOW_TEST_PAYMENTS_IN_PRODUCTION: '1', ALLOW_LOCAL_BACKEND_URL: 'true' }),
    ).toEqual(['DEMO_MODE', 'ALLOW_TEST_PAYMENTS_IN_PRODUCTION', 'ALLOW_LOCAL_BACKEND_URL'])
    expect(mockModeWarnings({ DEMO_MODE: 'TRUE' })).toEqual([])
  })

  test('EMAIL_PROVIDER=resend without RESEND_API_KEY now refuses production boot (the fixed logic bug)', async () => {
    const { emailDriverFailures } = await import('@/config/env')
    // The bug: this configuration used to slip through and email.ts silently
    // fell back to the console driver — customers would receive nothing.
    const failures = emailDriverFailures({ EMAIL_PROVIDER: 'resend' })
    expect(failures.some((f) => f.includes('EMAIL_PROVIDER=resend requires RESEND_API_KEY'))).toBeTrue()
    // Key present → fine.
    expect(emailDriverFailures({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' })).toEqual([])
    // DEMO_MODE staging deployments keep the documented escape hatch.
    expect(emailDriverFailures({ EMAIL_PROVIDER: 'resend', DEMO_MODE: 'true' })).toEqual([])
    // Explicit console driver on a real store still refuses.
    expect(emailDriverFailures({ EMAIL_PROVIDER: 'console' }).some((f) => f.includes('console (demo) driver'))).toBeTrue()
  })

  test('CRON_SECRET is required in production', async () => {
    const { cronSecretFailure } = await import('@/config/env')
    expect(cronSecretFailure({})).toContain('CRON_SECRET must be set')
    expect(cronSecretFailure({ CRON_SECRET: '   ' })).toContain('CRON_SECRET must be set')
    expect(cronSecretFailure({ CRON_SECRET: 's3cret-cron-value' })).toBeNull()
  })

  test('paymentOpsWarnings: unset international-card block / alert inbox warn at boot — a warning, never a refusal', async () => {
    const { paymentOpsWarnings } = await import('@/config/env')
    // Neither set → both reminders, and the call itself never throws
    // (a warning must not block the boot).
    expect(() => paymentOpsWarnings({})).not.toThrow()
    const both = paymentOpsWarnings({})
    expect(both).toHaveLength(2)
    expect(both.some((w) => w.includes('RAZORPAY_BLOCK_INTERNATIONAL_CARDS is not enabled (code default OFF)'))).toBeTrue()
    expect(both.some((w) => w.includes('PAYMENT_ALERT_EMAIL is unset'))).toBeTrue()
    // Explicitly OFF / blank counts as unset (the effective posture is what matters).
    expect(
      paymentOpsWarnings({ RAZORPAY_BLOCK_INTERNATIONAL_CARDS: 'false', PAYMENT_ALERT_EMAIL: '   ' }),
    ).toHaveLength(2)
    // The '1' alias enables the block like 'true'.
    expect(paymentOpsWarnings({ RAZORPAY_BLOCK_INTERNATIONAL_CARDS: '1' })).toHaveLength(1)
    // The recommended production posture silences both.
    expect(
      paymentOpsWarnings({ RAZORPAY_BLOCK_INTERNATIONAL_CARDS: 'true', PAYMENT_ALERT_EMAIL: 'alerts@sibra.example' }),
    ).toEqual([])
  })
})

describe('P3: terminal webhook results', () => {
  test('only handled results suppress redelivery; failed/unfinished re-process', async () => {
    const { isTerminalWebhookResult } = await import('@/lib/webhook-idempotency')
    for (const terminal of ['fulfilled', 'duplicate', 'ignored', 'unmatched', 'amount_mismatch', 'order_not_fulfillable', 'mismatch', 'rejected']) {
      expect(isTerminalWebhookResult(terminal)).toBeTrue()
    }
    for (const reprocess of [null, undefined, '', 'failed', 'anything-else']) {
      expect(isTerminalWebhookResult(reprocess)).toBeFalse()
    }
  })
})

describe('P4: heartbeat staleness', () => {
  test('warns only after the max age; a fresh or absent heartbeat never warns', async () => {
    const { heartbeatStale } = await import('@/services/cron-heartbeat')
    const now = new Date('2026-01-01T12:00:00Z')
    expect(heartbeatStale(null, now, 30 * 60_000)).toBeFalse() // never ran ≠ dead
    expect(heartbeatStale(new Date('2026-01-01T11:45:00Z'), now, 30 * 60_000)).toBeFalse()
    expect(heartbeatStale(new Date('2026-01-01T11:29:59Z'), now, 30 * 60_000)).toBeTrue()
  })
})
