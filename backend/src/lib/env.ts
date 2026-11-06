// ═══════════════════════════════════════════════════════════
// Environment validation (Zod) — postgres-only, fail-closed.
//
// • DATABASE_URL must be a postgres:// or postgresql:// URL in
//   EVERY environment (no other engine is supported anymore).
// • Production refuses to boot when a required secret is missing,
//   too short, or equals a known placeholder, or when
//   ADMIN_REQUIRE_2FA is false.
// • Development provides safe defaults so demo mode works with
//   only DATABASE_URL set (clearly-fake dev secrets are allowed).
//
// Validated lazily via getEnv() (called on first auth use) and
// eagerly at boot via src/instrumentation.ts.
// ═══════════════════════════════════════════════════════════

import { z } from 'zod'

const POSTGRES_SCHEMES = ['postgres://', 'postgresql://']

const KNOWN_PLACEHOLDERS = new Set([
  'change-me',
  'changeme',
  'change-me-to-a-long-random-hex',
  'adl-dev-secret-change-me-in-production',
  'dev-secret-change-me',
  'secret',
  'password',
  'placeholder',
])

const postgresUrl = z
  .string()
  .trim()
  .refine(
    (v) => POSTGRES_SCHEMES.some((scheme) => v.toLowerCase().startsWith(scheme)),
    { message: 'DATABASE_URL must be a PostgreSQL URL (postgres:// or postgresql://) — see scripts/dev-db.sh to set up a local database' },
  )

const secretField = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => !KNOWN_PLACEHOLDERS.has(v.toLowerCase()), { message: `${label} is still a known placeholder` })

const boolish = z
  .string()
  .optional()
  .transform((v) => v === undefined || v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
  .pipe(z.boolean().optional())

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl.optional(),
  SESSION_PEPPER: secretField('SESSION_PEPPER').optional(),
  ENCRYPTION_KEY: secretField('ENCRYPTION_KEY').optional(),
  ADMIN_REQUIRE_2FA: boolish,
  ADMIN_PASSKEYS_ENABLED: boolish,
  ADMIN_WEBAUTHN_RP_ID: z.string().trim().optional(),
  ADMIN_WEBAUTHN_RP_NAME: z.string().trim().optional(),
  ADMIN_WEBAUTHN_ORIGIN: z.string().trim().optional(),
  ADMIN_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).optional(),
  PUBLIC_WEB_URL: z.string().trim().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().trim().optional(),
  ADMIN_ALLOWED_ORIGINS: z.string().trim().optional(),
})

export interface ValidatedEnv {
  DATABASE_URL: string
  DIRECT_URL: string
  SESSION_PEPPER: string
  ENCRYPTION_KEY: string
  require2fa: boolean
  passkeysEnabled: boolean
  webauthnRpId: string
  webauthnRpName: string
  webauthnOrigin: string
  resetTtlMinutes: number
  publicWebUrl: string
  allowedOrigins: string[]
  isProduction: boolean
}

// ── Clearly-fake dev defaults (§0.4: local .env may contain only
//    clearly fake dev values). NEVER valid in production.
const DEV_PEPPER = 'sdh-dev-only-pepper-0000000000000000000000000000'
const DEV_ENCRYPTION_KEY = Buffer.from('sdh-dev-only-encryption-key-00000000000', 'utf8').toString('base64')

let cached: ValidatedEnv | null = null

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvValidationError'
  }
}

/** Validate + memoize environment. Throws EnvValidationError with an owner-actionable message. */
export function getEnv(): ValidatedEnv {
  if (cached) return cached

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new EnvValidationError(`Invalid environment: ${first?.message ?? 'unknown error'}`)
  }
  const raw = parsed.data
  const isProduction =
    process.env.NODE_ENV === 'production' && process.env.VERCEL === '1' ? true : process.env.NODE_ENV === 'production'

  const problems: string[] = []

  // ── Production hard rules (§3.12) ──
  let pepper = raw.SESSION_PEPPER ?? ''
  let encryptionKeyB64 = raw.ENCRYPTION_KEY ?? ''
  let require2fa = raw.ADMIN_REQUIRE_2FA ?? isProduction
  const passkeysEnabled = raw.ADMIN_PASSKEYS_ENABLED ?? true

  if (isProduction) {
    if (!pepper) problems.push('SESSION_PEPPER is required in production (generate: openssl rand -hex 32)')
    else if (pepper.length < 32) problems.push('SESSION_PEPPER must be at least 32 characters')
    if (!encryptionKeyB64) problems.push('ENCRYPTION_KEY is required in production (generate: openssl rand -base64 32)')
    if (require2fa === false) {
      problems.push('ADMIN_REQUIRE_2FA=false is not allowed in production — second factor is mandatory')
      require2fa = true
    }
  } else {
    pepper = pepper || DEV_PEPPER
    encryptionKeyB64 = encryptionKeyB64 || DEV_ENCRYPTION_KEY
  }

  let encryptionKey: Buffer
  try {
    encryptionKey = Buffer.from(encryptionKeyB64, 'base64')
  } catch {
    encryptionKey = Buffer.alloc(0)
  }
  if (encryptionKey.length !== 32) {
    problems.push('ENCRYPTION_KEY must decode to exactly 32 bytes (generate: openssl rand -base64 32)')
  }

  // WebAuthn configuration
  const webauthnRpId = raw.ADMIN_WEBAUTHN_RP_ID ?? (isProduction ? '' : 'localhost')
  const webauthnOrigin = raw.ADMIN_WEBAUTHN_ORIGIN ?? (isProduction ? '' : 'http://localhost:3000')
  const webauthnRpName = raw.ADMIN_WEBAUTHN_RP_NAME ?? 'Sibra Digital Hub'
  if (isProduction && passkeysEnabled) {
    if (!webauthnRpId) problems.push('ADMIN_WEBAUTHN_RP_ID is required in production when ADMIN_PASSKEYS_ENABLED=true')
    if (!webauthnOrigin) problems.push('ADMIN_WEBAUTHN_ORIGIN is required in production when ADMIN_PASSKEYS_ENABLED=true')
  }

  const publicWebUrl = (raw.PUBLIC_WEB_URL ?? raw.NEXT_PUBLIC_SITE_URL ?? (isProduction ? '' : 'http://localhost:3000')).replace(/\/+$/, '')

  // Allowed origins for admin CSRF/Origin checks: configured extras + public URL.
  const allowedOrigins = (raw.ADMIN_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (publicWebUrl) allowedOrigins.push(publicWebUrl)
  if (raw.NEXT_PUBLIC_SITE_URL) allowedOrigins.push(raw.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, ''))
  if (!isProduction) {
    allowedOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000')
  }

  if (problems.length > 0) {
    throw new EnvValidationError(`Refusing to start — fix the environment:\n- ${problems.join('\n- ')}`)
  }

  cached = {
    DATABASE_URL: raw.DATABASE_URL,
    DIRECT_URL: raw.DIRECT_URL ?? raw.DATABASE_URL,
    SESSION_PEPPER: pepper,
    ENCRYPTION_KEY: encryptionKeyB64,
    require2fa,
    passkeysEnabled,
    webauthnRpId,
    webauthnRpName,
    webauthnOrigin,
    resetTtlMinutes: raw.ADMIN_RESET_TTL_MINUTES ?? 30,
    publicWebUrl,
    allowedOrigins: Array.from(new Set(allowedOrigins.filter(Boolean))),
    isProduction,
  }
  return cached
}

/** Test-only helper (also used by CLI tools in watch scenarios). */
export function resetEnvCache(): void {
  cached = null
}
