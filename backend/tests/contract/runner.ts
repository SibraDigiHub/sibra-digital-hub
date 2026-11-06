// Contract snapshot runner — the safety net for every backend change.
// Capture: `bun tests/contract/runner.ts capture`  → writes golden/<name>.json
// Replay:  `bun tests/contract/runner.ts replay`   → compares live responses vs golden
//
// The contract = response SHAPE. Volatile values (ids, timestamps, emails,
// tokens, and on shape-only endpoints all numbers) are normalised so the test
// survives legitimate data changes while still failing on shape breaks.

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3001'
// T4-b: the backend middleware rejects /api/* calls without the frontend
// proxy's shared secret (bun auto-loads it from backend/.env).
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'golden')
const COOKIE_CACHE = join(dirname(fileURLToPath(import.meta.url)), '.admin-cookie')

type Endpoint = {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  /** shapeOnly: every number → <num> (for analytics/stats whose values drift) */
  shapeOnly?: boolean
  /** shapeKeysOnly: arrays → DEDUPED sorted key-list sets (row count/order drift: audit feeds) */
  shapeKeysOnly?: boolean
  /** deepShape: every leaf → type tag (live dashboard data: analytics/system) */
  deepShape?: boolean
  /** send the admin session cookie */
  auth?: boolean
}

const ENDPOINTS: Endpoint[] = [
  { name: 'health', method: 'GET', path: '/api' },
  { name: 'products-list', method: 'GET', path: '/api/products' },
  { name: 'products-zone-kids', method: 'GET', path: '/api/products?zone=kids' },
  { name: 'products-search-insensitive', method: 'GET', path: '/api/products?search=coloring' },
  { name: 'faqs', method: 'GET', path: '/api/faqs' },
  { name: 'reviews', method: 'GET', path: '/api/reviews' },
  { name: 'settings', method: 'GET', path: '/api/settings' },
  { name: 'geo', method: 'GET', path: '/api/geo' },
  // T10 — dynamic categories: the list itself is live admin data,
  // so only the ROW SHAPE SET is the contract (shapeKeysOnly).
  { name: 'categories', method: 'GET', path: '/api/categories', shapeKeysOnly: true },
  { name: 'admin-categories', method: 'GET', path: '/api/admin/categories', auth: true, shapeKeysOnly: true },
  { name: 'event-post', method: 'POST', path: '/api/events', body: { type: 'contract_test', zone: 'kids' }, shapeOnly: true },
  { name: 'imagekit-auth-nokey', method: 'GET', path: '/api/imagekit/auth', shapeOnly: true },
  // admin (auth)
  { name: 'admin-session', method: 'GET', path: '/api/admin/session', auth: true },
  { name: 'admin-stats', method: 'GET', path: '/api/admin/stats', auth: true, shapeOnly: true },
  { name: 'admin-analytics', method: 'GET', path: '/api/admin/analytics', auth: true, deepShape: true },
  { name: 'admin-customers', method: 'GET', path: '/api/admin/customers', auth: true },
  { name: 'admin-audit', method: 'GET', path: '/api/admin/audit', auth: true, shapeKeysOnly: true },
  { name: 'admin-system', method: 'GET', path: '/api/admin/system', auth: true, deepShape: true },
  { name: 'admin-order-by-id', method: 'GET', path: '/api/admin/orders/{firstOrderId}', auth: true },
]

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g
const DATE_ONLY_RE = /\d{4}-\d{2}-\d{2}/g
const CUID_RE = /\bc[a-z0-9]{20,}\b/g
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const HEX32_RE = /\b[0-9a-f]{32,}\b/g

function deepShapeOf(value: unknown): unknown {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array' // constant marker: element shapes covered by dedicated goldens
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepShapeOf(v)
    return out
  }
  return typeof value // 'string' | 'number' | 'boolean'
}

function normalize(value: unknown, shapeOnly: boolean, shapeKeysOnly = false, deepShape = false): unknown {
  if (deepShape) return deepShapeOf(value)
  if (typeof value === 'string') {
    let s = value.replace(ISO_RE, '<ts>').replace(CUID_RE, '<id>').replace(EMAIL_RE, '<email>').replace(HEX32_RE, '<tok>')
    if (shapeOnly) s = s.replace(DATE_ONLY_RE, '<date>')
    return s
  }
  if (typeof value === 'number') return shapeOnly ? '<num>' : value
  if (Array.isArray(value)) {
    if (shapeKeysOnly) {
      // Dedupe + sort: row count/order is live data; the ROW SHAPE SET is the contract.
      const seen = new Set<string>()
      for (const el of value) {
        const keys = el && typeof el === 'object' ? Object.keys(el as object).sort() : [typeof el]
        seen.add(JSON.stringify(keys))
      }
      return [...seen].map((k) => JSON.parse(k)).sort()
    }
    return value.map((v) => normalize(v, shapeOnly, shapeKeysOnly, deepShape))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalize(v, shapeOnly, shapeKeysOnly, deepShape)
    return out
  }
  return value
}

async function getAdminCookie(): Promise<string> {
  // Reuse a cached session cookie so rapid replays don't create login-rate-limit noise.
  if (existsSync(COOKIE_CACHE)) {
    const cached = readFileSync(COOKIE_CACHE, 'utf8').trim()
    if (cached) {
      const check = await fetch(`${BASE}/api/admin/session`, { headers: { cookie: cached, 'x-internal-key': INTERNAL_KEY } })
      const checkJson = (await check.json().catch(() => ({}))) as { authenticated?: boolean }
      if (check.ok && checkJson.authenticated === true) return cached
      unlinkSync(COOKIE_CACHE)
    }
  }
  // T4: real credentials (gitignored dev admin created via `bun run admin:create`).
  const email = process.env.CONTRACT_ADMIN_EMAIL
  const password = process.env.CONTRACT_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('CONTRACT_ADMIN_EMAIL / CONTRACT_ADMIN_PASSWORD missing (dev admin: bun run admin:create)')
  }
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`)
  const body = (await res.json()) as { stage?: string }
  if (body.stage === 'PENDING_2FA') {
    throw new Error('dev admin has 2FA enrolled — the contract runner needs a FULL session (recreate the admin or reset 2FA)')
  }
  const raw = res.headers.getSetCookie?.() ?? []
  const cookie = raw.map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('no session cookie returned')
  writeFileSync(COOKIE_CACHE, cookie)
  return cookie
}

async function fetchEndpoint(ep: Endpoint, adminCookie: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY }
  if (ep.auth) headers.cookie = adminCookie
  const res = await fetch(`${BASE}${ep.path}`, {
    method: ep.method,
    headers,
    body: ep.body === undefined ? undefined : JSON.stringify(ep.body),
  })
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = { _nonJson: text.slice(0, 200) }
  }
  return { status: res.status, body: normalize(json, ep.shapeOnly ?? false, ep.shapeKeysOnly ?? false, ep.deepShape ?? false) }
}

/** Discovers a real order id from the admin stats endpoint (shape contract never sees it). */
async function resolvePlaceholders(path: string, adminCookie: string): Promise<string> {
  if (!path.includes('{firstOrderId}')) return path
  const res = await fetch(`${BASE}/api/admin/stats`, { headers: { cookie: adminCookie, 'x-internal-key': INTERNAL_KEY } })
  const json = (await res.json()) as { recentOrders?: { id?: string }[] }
  const id = json.recentOrders?.[0]?.id
  if (!id) throw new Error('no order found for admin-order-by-id contract')
  return path.replace('{firstOrderId}', id)
}

async function main() {
  const mode = process.argv[2] ?? 'replay'
  mkdirSync(GOLDEN_DIR, { recursive: true })
  const adminCookie = await getAdminCookie()
  let failures = 0
  const lines: string[] = []

  for (const ep of ENDPOINTS) {
    const resolvedPath = ep.auth ? await resolvePlaceholders(ep.path, adminCookie) : ep.path
    const live = await fetchEndpoint({ ...ep, path: resolvedPath }, adminCookie)
    const goldenPath = join(GOLDEN_DIR, `${ep.name}.json`)
    const liveStr = JSON.stringify({ status: live.status, body: live.body }, null, 2)
    if (mode === 'capture') {
      writeFileSync(goldenPath, liveStr)
      lines.push(`CAPTURED ${ep.name} (${live.status})`)
      continue
    }
    if (!existsSync(goldenPath)) {
      failures++
      lines.push(`FAIL ${ep.name}: golden file missing`)
      continue
    }
    const golden = readFileSync(goldenPath, 'utf8')
    if (golden === liveStr) {
      lines.push(`PASS ${ep.name} (${live.status})`)
    } else {
      failures++
      lines.push(`FAIL ${ep.name}: contract drift`)
    }
  }

  console.log(lines.join('\n'))
  if (mode === 'replay') {
    if (failures > 0) {
      console.error(`\nCONTRACT REPLAY: ${failures} failure(s)`)
      process.exit(1)
    }
    console.log(`\nCONTRACT REPLAY: all ${ENDPOINTS.length} endpoints match`)
  } else {
    console.log(`\nCAPTURE: ${ENDPOINTS.length} golden files written`)
  }
}

main().catch((e) => {
  console.error('contract runner error:', e.message)
  process.exit(1)
})
