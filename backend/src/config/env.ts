// Single Zod-validated env module — the ONLY place that reads process.env.
// Server-only: import from backend code, never from anything bundled for the browser.
//
// T4: the legacy passcode/JWT auth (and its secrets) is gone.
// Admin auth now requires real secrets: ENCRYPTION_KEY (AES-256-GCM for TOTP
// secrets at rest) and SESSION_PEPPER (≥32 bytes of salt for IP/UA/code hashes).
// Production refuses to boot without them (or with known placeholders).
//
// T7 (§8.1): production additionally REFUSES to boot when any mock/console
// mode would silently degrade the shop — demo Razorpay (no keys), console
// email driver (explicit or via missing RESEND_API_KEY), a test-only
// EMAIL_API_URL override, or a missing/weak INTERNAL_API_KEY (the transport
// guard would 401 every /api call). Staging/demo deployments that accept
// these states can set DEMO_MODE=true as an explicit escape hatch.
import { z } from 'zod'

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

/** Known placeholder values that must never reach production. */
const SECRET_PLACEHOLDERS = new Set([
  'change-me',
  'changeme',
  'replace-me',
  'your-secret-here',
  'please-change-me',
  'sdh-dev-secret-change-me-in-production',
])

/** Decodes a base64 string and checks it has exactly n bytes of entropy. */
function isBase64OfLength(value: string, bytes: number): boolean {
  try {
    const buf = Buffer.from(value, 'base64')
    if (buf.length !== bytes) return false
    // reject values that were never real base64 (Buffer tolerates junk)
    const reencoded = buf.toString('base64').replace(/=+$/, '')
    return reencoded === value.replace(/=+$/, '')
  } catch {
    return false
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /** T5: must agree with the key prefix — 'test' ⇒ rzp_test_, 'live' ⇒ rzp_live_. */
  RAZORPAY_MODE: z.enum(['test', 'live']).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Price-arbitrage guard: refuses foreign-card payments on INR (India-billed)
   * orders only — never blocks foreign cards on foreign-currency orders.
   */
  RAZORPAY_BLOCK_INTERNATIONAL_CARDS: bool,
  /**
   * Single-gateway migration: non-India orders open only when the owner has
   * confirmed Razorpay International activation in the Dashboard. Default
   * false — foreign buyers get the friendly marketplace fallback until then.
   */
  INTERNATIONAL_CHECKOUT_ENABLED: bool,
  /** Comma list of foreign currencies enabled for this merchant (admin-set prices; no conversion). */
  RAZORPAY_FOREIGN_CURRENCIES: z.string().optional(),
  /** Comma-separated ISO-3166 alpha-2 codes refused for direct checkout (PAYPAL_BLOCKED_COUNTRIES kept as a legacy alias). */
  RAZORPAY_BLOCKED_COUNTRIES: z.string().optional(),
  /** TEST-ONLY override for the Razorpay API base (local mock server). Never in production. */
  RAZORPAY_API_BASE: z.string().optional(),
  /** T5: download-link lifetime (hours) minted at fulfillment. Default 48. */
  DOWNLOAD_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(48),
  /** T5: per-order download cap enforced atomically in the claim. Default 5. */
  DOWNLOAD_MAX_DEFAULT: z.coerce.number().int().min(1).max(100).default(5),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** T6: email driver — 'resend' | 'console'. Default: resend iff RESEND_API_KEY is set. */
  EMAIL_PROVIDER: z.enum(['resend', 'console']).optional(),
  /**
   * T6: internal override for the email API endpoint — ONLY for tests
   * (mock server). Must never be set in a real deployment.
   */
  EMAIL_API_URL: z.string().optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().optional(),
  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_PUBLIC_KEY: z.string().optional(),

  // ── Cloudflare R2 — private paid deliverables only ─────────
  // Optional: the application must still boot when R2 is not configured.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_S3_ENDPOINT: z.string().url().optional(),
  R2_REGION: z.string().default('auto'),

  // ── T4 admin auth ────────────────────────────────────────────
  /** AES-256-GCM key (32 random bytes, base64) — TOTP secrets at rest. */
  ENCRYPTION_KEY: z.string().optional(),
  /** ≥32 random bytes (base64) — salt for IP/UA/recovery-code hashes. */
  SESSION_PEPPER: z.string().optional(),
  /** Second factor mandatory. Default: true in production, false in dev. */
  ADMIN_REQUIRE_2FA: bool,
  /** WebAuthn passkey feature flag (default true). */
  ADMIN_PASSKEYS_ENABLED: bool,
  ADMIN_WEBAUTHN_RP_ID: z.string().optional(),
  ADMIN_WEBAUTHN_RP_NAME: z.string().optional(),
  ADMIN_WEBAUTHN_ORIGIN: z.string().optional(),
  ADMIN_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  /** Reset links are built from this — never from the request Host header. */
  PUBLIC_WEB_URL: z.string().optional(),
  /**
   * T7: explicit staging escape hatch — set to `true` ONLY on demo/staging
   * deployments to allow booting in production with demo payments and/or
   * the console email driver. Never set on a real store.
   */
  DEMO_MODE: bool,
  /** Behaviour toggles (dual payment §2.3/§6.7/§10.6). Defaults: no repeat purchase, revoke on refund. */
  ALLOW_REPEAT_PURCHASE: bool,
  REVOKE_ON_REFUND: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'), // default true
  /** §10.6 staging escape hatch: allows sandbox/test payment fulfilment in production. */
  ALLOW_TEST_PAYMENTS_IN_PRODUCTION: bool,
  /** Reserved escape hatch: allows localhost/127.0.0.1 backend URLs. Never for a real store. */
  ALLOW_LOCAL_BACKEND_URL: bool,
  /** Frontend-proxy shared secret (x-internal-key) — read now, guard wired later. */
  INTERNAL_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  /**
   * Legacy checkout escape hatch: POST /api/orders answers 410 Gone unless
   * this is explicitly true — and NEVER in production (P1: every order must
   * go through the country-confirmed checkout v2 flow).
   */
  LEGACY_ORDERS_ENABLED: bool,
})

export type Env = z.infer<typeof schema>

/**
 * P2 (pure, exported for boot-guard regression tests): the email driver a
 * production store would really use. DEMO_MODE deployments may tolerate the
 * console driver; a real store must not — including the previously-missed
 * case EMAIL_PROVIDER=resend with a missing key (email.ts would silently
 * fall back to console and customers would never receive downloads).
 */
export function emailDriverFailures(data: {
  DEMO_MODE?: string
  EMAIL_PROVIDER?: string
  RESEND_API_KEY?: string
}): string[] {
  const errors: string[] = []
  const demo = data.DEMO_MODE === 'true' || data.DEMO_MODE === '1'
  const provider = (data.EMAIL_PROVIDER ?? '').trim().toLowerCase()
  const consoleEmail = !demo && (provider === 'console' || (!data.RESEND_API_KEY && provider !== 'resend'))
  if (consoleEmail) {
    errors.push(
      'Email would use the console (demo) driver — customers never receive real download mail. Set RESEND_API_KEY (and EMAIL_PROVIDER=resend), or set DEMO_MODE=true for a staging deployment.',
    )
  }
  if (!demo && provider === 'resend' && !data.RESEND_API_KEY) {
    errors.push('EMAIL_PROVIDER=resend requires RESEND_API_KEY — without it the console (demo) driver would silently swallow customer emails')
  }
  return errors
}

/**
 * P2 (pure, exported for tests): the cron endpoints are the only path that
 * fulfils payments whose webhook was lost — an unset CRON_SECRET means they
 * are unreachable in production.
 */
export function cronSecretFailure(data: { CRON_SECRET?: string }): string | null {
  if (!data.CRON_SECRET || !data.CRON_SECRET.trim()) {
    return 'CRON_SECRET must be set — /api/cron/* refuses unauthenticated calls in production, so payments reconciliation and email retries would never run'
  }
  return null
}

export function productionFailures(data: Record<string, string | undefined>): string[] {
  const errors: string[] = []
  const enc = data.ENCRYPTION_KEY
  if (!enc || enc.includes(' ') || SECRET_PLACEHOLDERS.has(enc) || !isBase64OfLength(enc, 32)) {
    errors.push('ENCRYPTION_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)')
  }
  const pepper = data.SESSION_PEPPER
  if (
    !pepper ||
    Buffer.from(pepper).length < 32 ||
    SECRET_PLACEHOLDERS.has(pepper) ||
    !isBase64OfLength(pepper, 32)
  ) {
    errors.push('SESSION_PEPPER must be ≥32 random bytes, base64-encoded (openssl rand -base64 32)')
  }
  const require2faRaw = process.env.ADMIN_REQUIRE_2FA
  if (require2faRaw === 'false' || require2faRaw === '0') {
    errors.push('ADMIN_REQUIRE_2FA=false is not allowed in production')
  }
  if (!data.PUBLIC_WEB_URL || !data.PUBLIC_WEB_URL.startsWith('https://')) {
    errors.push('PUBLIC_WEB_URL must be an https:// URL in production')
  }
  const razorMode = razorpayModeFailure(data)
  if (razorMode) errors.push(razorMode)

  // ── Single-gateway: Razorpay guards ───────────────────────────
  const paypalOverride = data.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === 'true' || data.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === '1'
  if (data.RAZORPAY_API_BASE) {
    errors.push('RAZORPAY_API_BASE is a test-only override and must never be set in production')
  }
  if (data.RAZORPAY_MODE === 'test' && !paypalOverride) {
    errors.push('RAZORPAY_MODE=test is not allowed in production — switch to live keys, or set ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true for an explicit staging deployment')
  }

  errors.push(...webhookSecretFailures(data))

  // ── T7: transport secret (the x-internal-key guard depends on it) ──
  const internalKey = data.INTERNAL_API_KEY
  if (!internalKey || internalKey.length < 16 || SECRET_PLACEHOLDERS.has(internalKey)) {
    errors.push('INTERNAL_API_KEY must be set (≥16 random chars) — every /api call is refused without it')
  }

  // ── T7: mock/console modes must be explicit (DEMO_MODE=true) in production ──
  if (data.DEMO_MODE !== 'true' && data.DEMO_MODE !== '1') {
    // Demo payments (no Razorpay keys ⇒ demo-pay simulation only).
    if (!data.RAZORPAY_KEY_ID || !data.RAZORPAY_KEY_SECRET) {
      errors.push(
        'Razorpay keys are missing — payments would run in demo mode. Set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET, or set DEMO_MODE=true for a staging deployment.',
      )
    }
    // Mock email driver (explicit console, or resend selected but key missing).
    errors.push(...emailDriverFailures(data))
  }

  const cronFailure = cronSecretFailure(data)
  if (cronFailure) errors.push(cronFailure)
  // T6 test-only override must never reach production regardless of DEMO_MODE.
  if (data.EMAIL_API_URL) {
    errors.push('EMAIL_API_URL is a test-only override and must never be set in production')
  }
  return errors
}

/**
 * P2 (pure, unit-testable): mock/sandbox flags active in production get a
 * loud boot warning — they degrade a real store (demo payments, console
 * email, local URLs) and the owner must be able to spot that after deploy.
 * Returned as short flag names; the multi-line print lives in loadEnv().
 */
export function mockModeWarnings(data: {
  DEMO_MODE?: string
  ALLOW_TEST_PAYMENTS_IN_PRODUCTION?: string
  ALLOW_LOCAL_BACKEND_URL?: string
}): string[] {
  const active: string[] = []
  if (data.DEMO_MODE === 'true' || data.DEMO_MODE === '1') active.push('DEMO_MODE')
  if (data.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === 'true' || data.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === '1') {
    active.push('ALLOW_TEST_PAYMENTS_IN_PRODUCTION')
  }
  if (data.ALLOW_LOCAL_BACKEND_URL === 'true' || data.ALLOW_LOCAL_BACKEND_URL === '1') active.push('ALLOW_LOCAL_BACKEND_URL')
  return active
}

/**
 * Production payment-ops reminders — WARNING only, never a refusal. The two
 * settings that keep a live store protected and observable: blocking foreign
 * cards on INR Razorpay orders (code default OFF) and routing payment anomaly
 * alerts (signature failures, disputes, stuck orders) to a monitored inbox.
 * Unset/blank ⇒ a boot warning so the owner decides deliberately.
 * Pure + env-injectable so the boot-guard regression tests can call it.
 */
export function paymentOpsWarnings(data: {
  RAZORPAY_BLOCK_INTERNATIONAL_CARDS?: string
  PAYMENT_ALERT_EMAIL?: string
}): string[] {
  const warnings: string[] = []
  const block = data.RAZORPAY_BLOCK_INTERNATIONAL_CARDS
  if (block !== 'true' && block !== '1') {
    warnings.push(
      'RAZORPAY_BLOCK_INTERNATIONAL_CARDS is not enabled (code default OFF) — foreign cards on INR Razorpay orders will be fulfilled, not blocked. Set it to "true" for the recommended production posture.',
    )
  }
  if (!data.PAYMENT_ALERT_EMAIL || !data.PAYMENT_ALERT_EMAIL.trim()) {
    warnings.push(
      'PAYMENT_ALERT_EMAIL is unset — payment anomaly alerts fall back to the first admin user. Set an explicit monitored inbox.',
    )
  }
  return warnings
}

/** P2: truthy ALLOW_TEST_PAYMENTS_IN_PRODUCTION (exposed on GET /api health). */
export function testPaymentsAllowed(): boolean {
  return process.env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === 'true' || process.env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === '1'
}

/**
 * P1: legacy POST /api/orders is retired — 410 unless explicitly re-enabled
 * OUTSIDE production. Production has no override: every order must come
 * through checkout v2 (confirmed country, server-side gateway/currency,
 * Idempotency-Key, consent).
 */
export function legacyOrdersEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.LEGACY_ORDERS_ENABLED === 'true' || process.env.LEGACY_ORDERS_ENABLED === '1'
}

/**
 * §10.6: sandbox/test fulfilment guard — test-mode gateways must never
 * deliver real files to the public. True when a test/sandbox gateway is
 * configured in production without the explicit staging override.
 * (Reads process.env directly — same runtime-check convention as demoMode().)
 */
export function testPaymentFulfillmentBlocked(): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  if (process.env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === 'true' || process.env.ALLOW_TEST_PAYMENTS_IN_PRODUCTION === '1') return false
  if (process.env.RAZORPAY_MODE === 'test') return true
  return false
}

/**
 * Demo/staging escape hatch (T7): true only when DEMO_MODE was explicitly
 * enabled. Consumed by checks that need to tolerate demo providers.
 */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1'
}

/**
 * Re-audit B2: mock payment routes are invisible in real production, but
 * an explicit DEMO_MODE=true staging deployment keeps them (its documented
 * purpose). Pure + env-injectable so the gate is unit-testable.
 */
export function demoRouteBlocked(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'production' && !demoMode()
}

/**
 * T5: RAZORPAY_MODE (test | live) must agree with the Razorpay key prefix
 * (rzp_test_ / rzp_live_). With keys present but no mode declared, production
 * refuses to boot; the returned string is the reason.
 */
export function razorpayModeFailure(data: {
  RAZORPAY_KEY_ID?: string
  RAZORPAY_MODE?: string
}): string | null {
  const keyId = data.RAZORPAY_KEY_ID
  if (!keyId) return null // demo mode — no keys, no prefix contract
  const mode = data.RAZORPAY_MODE
  const isTest = keyId.startsWith('rzp_test_')
  const isLive = keyId.startsWith('rzp_live_')
  if (!isTest && !isLive) {
    return 'RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_'
  }
  if (!mode) {
    return 'RAZORPAY_MODE must be set to "test" or "live" to match the Razorpay key prefix'
  }
  if (mode === 'test' && !isTest) {
    return 'RAZORPAY_MODE=test requires a rzp_test_… key id'
  }
  if (mode === 'live' && !isLive) {
    return 'RAZORPAY_MODE=live requires a rzp_live_… key id'
  }
  return null
}

/**
 * Re-audit B2: webhook secrets are load-bearing in production.
 * Razorpay fulfillment depends on webhooks (without the secret every
 * delivery is rejected and orders only reconcile via cron).
 * Exported pure so the boot-guard regression tests can call it directly.
 */
export function webhookSecretFailures(data: {
  RAZORPAY_KEY_ID?: string
  RAZORPAY_KEY_SECRET?: string
  RAZORPAY_WEBHOOK_SECRET?: string
}): string[] {
  const errors: string[] = []
  if (data.RAZORPAY_KEY_ID && data.RAZORPAY_KEY_SECRET && !data.RAZORPAY_WEBHOOK_SECRET) {
    errors.push('RAZORPAY_WEBHOOK_SECRET is required in production when Razorpay keys are set — webhook deliveries drive fulfillment')
  }
  return errors
}

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (!parsed.data.DATABASE_URL.startsWith('postgres')) {
      throw new Error('DATABASE_URL must be a PostgreSQL connection string in production')
    }
    const failures = productionFailures(process.env as Record<string, string | undefined>)
    if (failures.length > 0) {
      throw new Error(`Refusing to start in production — insecure auth configuration:\n- ${failures.join('\n- ')}`)
    }
    // P2: loud multi-line boot warning — an owner checking a deployed store
    // must not need to guess why payments/emails behave like a demo.
    const warnings = mockModeWarnings(process.env as Record<string, string | undefined>)
    if (warnings.length > 0) {
      console.error(
        [
          '',
          '╔══════════════════════════════════════════════════════════════╗',
          '║  ⚠️  PRODUCTION BOOT WITH MOCK / SANDBOX FLAGS ACTIVE         ║',
          '╠══════════════════════════════════════════════════════════════╣',
          ...warnings.map((flag) => `║  • ${flag.padEnd(59)}║`),
          '║                                                              ║',
          '║  This deployment will simulate payments / log emails instead ║',
          '║  of charging real customers. Verify it is intentional.       ║',
          `║  Live check: GET /api → { demoMode, testPaymentsAllowed }    ║`,
          '╚══════════════════════════════════════════════════════════════╝',
          '',
        ].join('\n'),
      )
    }
    // Payment-ops hygiene reminders: a WARNING (boot continues), never a
    // refusal — the owner may deliberately accept either posture.
    const opsWarnings = paymentOpsWarnings(process.env as Record<string, string | undefined>)
    if (opsWarnings.length > 0) {
      console.error(
        [
          '',
          '⚠️  PRODUCTION BOOT WARNINGS — payment ops (continuing, not refusing):',
          ...opsWarnings.map((w) => `  • ${w}`),
          '',
        ].join('\n'),
      )
    }
  }
  return parsed.data
}

export const env = loadEnv()

/** Second factor mandatory? Production default true; dev default false unless set. */
export const adminRequire2fa = (): boolean =>
  process.env.ADMIN_REQUIRE_2FA !== undefined
    ? env.ADMIN_REQUIRE_2FA
    : env.NODE_ENV === 'production'

/** Passkeys enabled (default true unless explicitly disabled). */
export const adminPasskeysEnabled = (): boolean => process.env.ADMIN_PASSKEYS_ENABLED !== 'false'

/** T5: dev-only advisory when mode/prefix disagree (production refuses to boot instead). */
export function razorpayModeWarning(): string | null {
  if (env.NODE_ENV === 'production') return null
  return razorpayModeFailure({
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_MODE: process.env.RAZORPAY_MODE,
  })
}

/** Download-link TTL in hours (env-configurable, default 48). */
export const downloadTtlHours = (): number => env.DOWNLOAD_TTL_HOURS

/** §11 behaviour toggles (dual payment). */
export const allowRepeatPurchase = (): boolean => env.ALLOW_REPEAT_PURCHASE
export const revokeOnRefund = (): boolean => env.REVOKE_ON_REFUND
export const blockInternationalCards = (): boolean => env.RAZORPAY_BLOCK_INTERNATIONAL_CARDS
/** Single-gateway: are non-India orders open? (owner flips after Razorpay International activation). */
export function internationalCheckoutEnabled(): boolean {
  return process.env.INTERNATIONAL_CHECKOUT_ENABLED === 'true' || process.env.INTERNATIONAL_CHECKOUT_ENABLED === '1'
}

/**
 * Comma-separated RAZORPAY_BLOCKED_COUNTRIES → Set (empty by default).
 * The retired PAYPAL_BLOCKED_COUNTRIES variable is honoured as a legacy
 * alias so an uncleaned deploy env keeps its old blocking behaviour.
 */
export function razorpayBlockedCountries(): Set<string> {
  const raw = process.env.RAZORPAY_BLOCKED_COUNTRIES ?? process.env.PAYPAL_BLOCKED_COUNTRIES ?? ''
  return new Set(
    raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  )
}

/**
 * The foreign currencies the owner enabled for this merchant (default USD).
 * Prices are admin-set DB fields per currency — never conversions.
 */
export function razorpayForeignCurrencies(): string[] {
  return (process.env.RAZORPAY_FOREIGN_CURRENCIES ?? 'USD')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c))
}

/** Per-order download cap (env-configurable, default 5). */
export const downloadMaxDefault = (): number => env.DOWNLOAD_MAX_DEFAULT

/**
 * Effective auth-secret status for the admin "system health" panel.
 * (Kept out of loadEnv so dev can boot without secrets — production cannot.)
 */
export function authSecretsStatus(): boolean {
  const enc = process.env.ENCRYPTION_KEY
  const pepper = process.env.SESSION_PEPPER
  return Boolean(
    enc &&
      pepper &&
      !SECRET_PLACEHOLDERS.has(enc) &&
      !SECRET_PLACEHOLDERS.has(pepper) &&
      isBase64OfLength(enc, 32) &&
      Buffer.from(pepper).length >= 32,
  )
}
