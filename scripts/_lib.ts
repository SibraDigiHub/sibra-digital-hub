// ═══════════════════════════════════════════════════════════
// Shared helpers for the root verifier scripts (smoke, integrity,
// payments assist, support lookup). Root convenience layer only —
// no imports from frontend/ or backend/ source (folder law).
// ═══════════════════════════════════════════════════════════

export type Env = 'local' | 'staging' | 'prod'

export interface Check {
  id: string
  label: string
  ok: boolean
  /** WARN rows never fail the run; SKIP rows are not applicable. */
  kind: 'pass' | 'fail' | 'warn' | 'skip'
  detail: string
  ms?: number
}

export function pass(id: string, label: string, detail: string, ms?: number): Check {
  return { id, label, ok: true, kind: 'pass', detail, ms }
}
export function fail(id: string, label: string, detail: string, ms?: number): Check {
  return { id, label, ok: false, kind: 'fail', detail, ms }
}
export function warn(id: string, label: string, detail: string): Check {
  return { id, label, ok: true, kind: 'warn', detail }
}
export function skip(id: string, label: string, detail: string): Check {
  return { id, label, ok: true, kind: 'skip', detail }
}

export function printCheckTable(title: string, checks: Check[]): void {
  const widths = {
    result: 5,
    label: Math.max(...checks.map((c) => c.label.length), 10),
  }
  console.log(`\n──── ${title} ────`)
  for (const c of checks) {
    const tag = c.kind.toUpperCase().padEnd(5)
    const ms = c.ms === undefined ? '' : ` (${c.ms}ms)`
    console.log(`${tag}  ${c.label.padEnd(widths.label)}  ${c.detail}${ms}`)
  }
  const failed = checks.filter((c) => c.kind === 'fail').length
  const warns = checks.filter((c) => c.kind === 'warn').length
  const skips = checks.filter((c) => c.kind === 'skip').length
  console.log(`──── ${checks.length - failed - warns - skips}/${checks.length} passed, ${warns} warn, ${skips} skip, ${failed} failed ────`)
}

/** Markdown report writer → reports/verify-<env>-<timestamp>.md */
export function writeReport(env: Env, title: string, checks: Check[], extraSections: string[] = []): string {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const root = path.resolve(import.meta.dir, '..')
  const dir = path.join(root, 'reports')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(dir, `verify-${env}-${stamp}.md`)
  const lines = [
    `# ${title}`,
    ``,
    `- environment: \`${env}\``,
    `- date: ${new Date().toISOString()}`,
    `- result: ${checks.some((c) => c.kind === 'fail') ? 'FAIL' : 'PASS'}`,
    ``,
    `| result | check | detail |`,
    `|---|---|---|`,
    ...checks.map((c) => `| ${c.kind.toUpperCase()} | ${c.label} | ${c.detail.replace(/\|/g, '\\|')} |`),
    ``,
    ...extraSections,
  ]
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return path.relative(root, file)
}

export interface Targets {
  frontendUrl: string
  backendUrl: string
}

/**
 * Resolve the URLs to verify. local defaults to the dev servers;
 * staging/prod REQUIRE FRONTEND_URL + BACKEND_URL from the environment
 * (never hard-coded) and must be https.
 */
export function resolveTargets(env: Env): Targets {
  if (env === 'local') {
    return {
      frontendUrl: process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000',
      backendUrl: process.env.BACKEND_URL ?? 'http://127.0.0.1:3001',
    }
  }
  const frontendUrl = process.env.FRONTEND_URL
  const backendUrl = process.env.BACKEND_URL
  if (!frontendUrl || !backendUrl) {
    console.error(`smoke ${env}: FRONTEND_URL and BACKEND_URL must be set (see docs/TESTING.md).`)
    process.exit(1)
  }
  for (const [name, url] of [['FRONTEND_URL', frontendUrl], ['BACKEND_URL', backendUrl]] as const) {
    if (!url.startsWith('https://')) {
      // Documented LOCAL opt-out: verify a production build on this machine
      // (SIBRA smoke --env prod semantics). Never applies to public hosts.
      const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url)
      if (!(process.env.SMOKE_ALLOW_HTTP === 'true' && local)) {
        console.error(`smoke ${env}: ${name} must be https (got ${url.split('//')[0]}//…) — local production-build runs may set SMOKE_ALLOW_HTTP=true for localhost URLs`)
        process.exit(1)
      }
    }
  }
  return { frontendUrl: frontendUrl.replace(/\/$/, ''), backendUrl: backendUrl.replace(/\/$/, '') }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' })
  } finally {
    clearTimeout(timer)
  }
}

/** Mirror of backend/scripts/check-leaks.ts LEAK_TERMS — keep in sync. */
export const LEAK_TERMS = [
  'deliverableUrl',
  'deliverableName',
  'deliverable',
  'fileId',
  'tokenHash',
  'key_secret',
  'client_secret',
  'ik-sig',
  'ik-exp',
] as const

/** Find leak terms in a JSON-serialisable payload. Returns "term (path)". */
export function findLeakTerms(value: unknown, path = '$'): string[] {
  const hits: string[] = []
  if (typeof value === 'string') {
    for (const term of LEAK_TERMS) if (value.includes(term)) hits.push(`${term} @ ${path}`)
    return hits
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...findLeakTerms(item, `${path}[${i}]`)))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (LEAK_TERMS.some((t) => key.toLowerCase().includes(t.toLowerCase()))) hits.push(`${key} @ ${path}`)
      hits.push(...findLeakTerms(item, `${path}.${key}`))
    }
  }
  return hits
}

/** p95 of a sample array (nearest-rank, no external deps). */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

/** Mask an e-mail for human-readable, PII-free output: a***@d***.com */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${email[0]}***@${domain[0]}***${tld}`
}

/** Never print a full token/secret: first 4 + … + length. */
export function maskSecret(value: string): string {
  return `${value.slice(0, 4)}…<${value.length} chars>`
}
