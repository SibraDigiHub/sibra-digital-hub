// ═══════════════════════════════════════════════════════════
// T7 (§8.1) — single Zod-validated env module for the frontend.
// The ONLY place server-side frontend code reads process.env.
// Server-only secrets (BACKEND_URL, INTERNAL_API_KEY) must never
// be imported from client components — only NEXT_PUBLIC_* values
// are intended to reach the browser bundle.
//
// Production guard: INTERNAL_API_KEY is required — without it the
// proxy would attach an empty x-internal-key and the backend would
// 401 every single /api call. next.config.ts keeps reading
// BACKEND_URL directly (it executes in Next's own config context),
// this module serves the app/proxy runtime.
//
// T9: API_INTERNAL_URL (spec §10.2 name) is accepted as an alias for
// BACKEND_URL — BACKEND_URL wins when both are set.
// ═══════════════════════════════════════════════════════════

import { z } from 'zod'

const SECRET_PLACEHOLDERS = new Set([
  'change-me',
  'changeme',
  'replace-me',
  'your-secret-here',
  'please-change-me',
  'sdh-dev-secret-change-me-in-production',
])

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Server-side rewrite target for /api/* (must be a valid origin). */
  BACKEND_URL: z.string().default('http://localhost:3001'),
  /** Shared secret attached as x-internal-key before proxying (server-only). */
  INTERNAL_API_KEY: z.string().optional(),
  /** Public site origin (consumed by T8 metadata/sitemap work; safe for the browser). */
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
})

export type FeEnv = z.infer<typeof schema>

let cached: FeEnv | null = null

function load(): FeEnv {
  const source: Record<string, string | undefined> = { ...process.env }
  if (source.BACKEND_URL === undefined && source.API_INTERNAL_URL) {
    source.BACKEND_URL = source.API_INTERNAL_URL
  }
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    throw new Error(
      `Invalid frontend environment: ${parsed.error.issues.map((i) => i.path.join('.') || 'env').join(', ')}`,
    )
  }
  const env = parsed.data
  try {
    new URL(env.BACKEND_URL)
  } catch {
    throw new Error(`BACKEND_URL must be a valid URL (got "${env.BACKEND_URL}")`)
  }
  if (env.NODE_ENV === 'production') {
    const key = env.INTERNAL_API_KEY
    if (!key || key.length < 16 || SECRET_PLACEHOLDERS.has(key)) {
      throw new Error(
        'INTERNAL_API_KEY must be set (≥16 random chars) in production — the /api proxy cannot authenticate without it',
      )
    }
  }
  return env
}

/** Parse-once accessor (lazy so dev keeps booting without any secrets). */
export function feEnv(): FeEnv {
  if (!cached) cached = load()
  return cached
}

/** The x-internal-key value the proxy attaches (empty string in misconfigured dev). */
export function internalApiKey(): string {
  return feEnv().INTERNAL_API_KEY ?? ''
}
