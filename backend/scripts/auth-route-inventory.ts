// ═══════════════════════════════════════════════════════════
// T4 route-inventory test — enumerates ALL /api/admin/* routes
// and asserts each is protected without a valid FULL session:
//   PROTECTED    → must answer 401/403 (requireAdmin + CSRF)
//   SELF_SERVICE → 200 but only harmless bodies (logout idempotent,
//                  session probe authenticated:false, forgot-password
//                  fixed anti-enumeration message)
//   AUTH         → pre-auth endpoints must never answer 200 with
//                  privileged data (400/401/403/429 here)
// Also cross-checks the hardcoded list against the filesystem so a
// new admin route can never ship ungated.
// Usage: bun scripts/auth-route-inventory.ts   (dev server on :3001)
// ═══════════════════════════════════════════════════════════

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3001'

type Kind = 'PROTECTED' | 'SELF_SERVICE' | 'AUTH'
interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  kind: Kind
  body?: unknown
}

// Hardcoded from src/app/api/admin tree (the cross-check below fails the
// script if a route.ts exists that is missing here).
const ROUTES: RouteSpec[] = [
  // existing feature endpoints
  { method: 'GET', path: '/api/admin/stats', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/analytics', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/audit', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/customers', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/customers/nobody@example.com', kind: 'PROTECTED' },
  { method: 'DELETE', path: '/api/admin/customers/nobody@example.com', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/export', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/orders/ckfakeid00000000000000', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/system', kind: 'PROTECTED' },
  // catalog + order operations (added with the T10/channels batches —
  // the filesystem cross-check below fails if this list drifts again)
  { method: 'GET', path: '/api/admin/categories', kind: 'PROTECTED' },
  { method: 'POST', path: '/api/admin/categories', kind: 'PROTECTED', body: {} },
  { method: 'PATCH', path: '/api/admin/categories/ckfakeid00000000000000', kind: 'PROTECTED', body: {} },
  { method: 'DELETE', path: '/api/admin/categories/ckfakeid00000000000000', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/channels', kind: 'PROTECTED' },
  { method: 'POST', path: '/api/admin/channels', kind: 'PROTECTED', body: {} },
  { method: 'PATCH', path: '/api/admin/channels/ckfakeid00000000000000', kind: 'PROTECTED', body: {} },
  { method: 'DELETE', path: '/api/admin/channels/ckfakeid00000000000000', kind: 'PROTECTED' },
  { method: 'GET', path: '/api/admin/security-events', kind: 'PROTECTED' },
  { method: 'POST', path: '/api/admin/step-up', kind: 'PROTECTED', body: {} },
  { method: 'GET', path: '/api/admin/reviews/product', kind: 'PROTECTED' },
  { method: 'PATCH', path: '/api/admin/reviews/product/ckfakeid00000000000000', kind: 'PROTECTED', body: {} },
  { method: 'DELETE', path: '/api/admin/reviews/product/ckfakeid00000000000000', kind: 'PROTECTED' },
  { method: 'POST', path: '/api/admin/orders/ckfakeid00000000000000/reconcile', kind: 'PROTECTED', body: {} },
  { method: 'GET', path: '/api/admin/orders/ckfakeid00000000000000/watch', kind: 'PROTECTED' },
  { method: 'PATCH', path: '/api/admin/orders/ckfakeid00000000000000/watch', kind: 'PROTECTED', body: {} },
  { method: 'POST', path: '/api/admin/orders/ckfakeid00000000000000/watch-preview', kind: 'PROTECTED', body: {} },
  { method: 'DELETE', path: '/api/admin/sessions/ckfakeid00000000000000', kind: 'PROTECTED' },
  { method: 'POST', path: '/api/admin/sessions/revoke-others', kind: 'PROTECTED', body: {} },
  // auth lifecycle
  { method: 'POST', path: '/api/admin/login', kind: 'AUTH', body: {} },
  { method: 'POST', path: '/api/admin/login/2fa', kind: 'AUTH', body: { code: '000000' } },
  { method: 'POST', path: '/api/admin/login/passkey/options', kind: 'SELF_SERVICE', body: { email: 'nobody@example.com' } },
  { method: 'POST', path: '/api/admin/login/passkey/verify', kind: 'AUTH', body: { email: 'nobody@example.com', response: {} } },
  { method: 'POST', path: '/api/admin/forgot-password', kind: 'SELF_SERVICE', body: { email: 'nobody@example.com' } },
  { method: 'POST', path: '/api/admin/reset-password', kind: 'AUTH', body: { token: 'x'.repeat(43), password: 'x', secondFactor: { totp: '000000' } } },
  { method: 'GET', path: '/api/admin/session', kind: 'SELF_SERVICE' },
  { method: 'POST', path: '/api/admin/logout', kind: 'SELF_SERVICE' },
  // account security (all need a FULL/ENROLL session)
  { method: 'POST', path: '/api/admin/password', kind: 'PROTECTED', body: {} },
  { method: 'POST', path: '/api/admin/2fa/enroll', kind: 'PROTECTED', body: {} },
  { method: 'POST', path: '/api/admin/2fa/confirm', kind: 'PROTECTED', body: {} },
  { method: 'POST', path: '/api/admin/2fa/disable', kind: 'PROTECTED', body: {} },
  { method: 'POST', path: '/api/admin/recovery-codes/regenerate', kind: 'PROTECTED', body: {} },
  { method: 'GET', path: '/api/admin/passkeys', kind: 'PROTECTED' },
  { method: 'DELETE', path: '/api/admin/passkeys/ckfakeid00000000000000', kind: 'PROTECTED' },
  { method: 'POST', path: '/api/admin/passkeys/register/options', kind: 'PROTECTED', body: {} },
  { method: 'POST', path: '/api/admin/passkeys/register/verify', kind: 'PROTECTED', body: {} },
  { method: 'GET', path: '/api/admin/sessions', kind: 'PROTECTED' },
  { method: 'DELETE', path: '/api/admin/sessions', kind: 'PROTECTED' },
]

/** Walk the admin route tree and return `${method} ${path}` for every route.ts. */
function discoverRoutes(): string[] {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'api', 'admin')
  const found: string[] = []
  const walk = (dir: string, urlPrefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full, `${urlPrefix}/${entry}`)
      } else if (entry === 'route.ts') {
        const src = readFileSync(full, 'utf8')
        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) =>
          new RegExp(`export (async function ${m}|const ${m})`).test(src),
        )
        for (const m of methods) found.push(`${m} ${urlPrefix}`)
      }
    }
  }
  if (!existsSync(root)) throw new Error(`admin route tree missing: ${root}`)
  walk(root, '/api/admin')
  return found.sort()
}

async function call(spec: RouteSpec): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${spec.path}`, {
    method: spec.method,
    headers: {
      'content-type': 'application/json',
      // Same-origin Origin header: the probes emulate the real frontend
      // (same origin as BASE). Without it, WebAuthn-backed routes (passkey
      // login options) cannot derive their dev RP pair and answer 503 —
      // the inventory would test the wrong thing.
      origin: new URL(BASE).origin,
      // the transport guard (x-internal-key) sits in FRONT of auth; without
      // it every SELF_SERVICE probe answers 401 for the wrong reason and
      // the inventory cannot test what it exists to test.
      ...(process.env.INTERNAL_API_KEY ? { 'x-internal-key': process.env.INTERNAL_API_KEY } : {}),
    },
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    redirect: 'manual',
  })
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

function verdict(spec: RouteSpec, status: number, body: unknown): { ok: boolean; note: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (spec.kind === 'PROTECTED') {
    const ok = status === 401 || status === 403
    return { ok, note: ok ? `blocked (${status})` : `LEAK? status=${status}` }
  }
  if (spec.kind === 'SELF_SERVICE') {
    if (spec.path === '/api/admin/session') {
      const ok = status === 200 && b.authenticated === false
      return { ok, note: ok ? 'authenticated:false' : `unexpected (${status})` }
    }
    if (spec.path === '/api/admin/forgot-password') {
      const ok = status === 200 && typeof b.message === 'string' && b.ok === true
      return { ok, note: ok ? 'generic message' : `unexpected (${status})` }
    }
    if (spec.path === '/api/admin/login/passkey/options') {
      // Anti-enumeration: unknown emails get IDENTICAL-looking (empty) options.
      const o = b.options as Record<string, unknown> | undefined
      const ok = status === 200 && Boolean(o?.challenge) && Array.isArray(o?.allowCredentials) && (o.allowCredentials as unknown[]).length === 0
      return { ok, note: ok ? 'empty options (anti-enumeration)' : `unexpected (${status})` }
    }
    // logout: idempotent 200 {ok:true}
    const ok = status === 200 && b.ok === true
    return { ok, note: ok ? 'ok (no session to revoke)' : `unexpected (${status})` }
  }
  // AUTH: validation/auth failures only — never 200/500
  const ok = [400, 401, 403, 429].includes(status)
  return { ok, note: ok ? `rejected (${status})` : `LEAK? status=${status}` }
}

async function main() {
  // 1) inventory completeness: every admin route.ts must be in the list
  //    (dynamic segments like [email] match any concrete value in the list)
  const discovered = discoverRoutes()
  const listed = new Set(ROUTES.map((r) => `${r.method} ${r.path}`))
  const missing = discovered.filter((d) => {
    if (listed.has(d)) return false
    const [method, path] = d.split(' ')
    const pattern = new RegExp(`^${method} ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[[^\\]+\\\]/g, '[^/]+')}$`)
    return !ROUTES.some((r) => pattern.test(`${r.method} ${r.path}`))
  })
  if (missing.length > 0) {
    console.error('INVENTORY DRIFT — routes on disk but not in the list:')
    for (const m of missing) console.error(`  ${m}`)
    console.error('Add them to ROUTES above and re-run.')
    process.exit(1)
  }

  // 2) per-route assertions
  let failures = 0
  const lines: string[] = []
  for (const spec of ROUTES) {
    const { status, body } = await call(spec)
    const { ok, note } = verdict(spec, status, body)
    if (!ok) failures++
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${spec.method.padEnd(6)} ${spec.path.padEnd(46)} [${spec.kind}] ${note}`)
  }
  console.log(lines.join('\n'))
  if (failures > 0) {
    console.error(`\nROUTE INVENTORY: ${failures} failure(s) of ${ROUTES.length}`)
    process.exit(1)
  }
  console.log(`\nROUTE INVENTORY: all ${ROUTES.length} routes verified (${discovered.length} discovered on disk)`)
}

main().catch((e) => {
  console.error('route inventory error:', e.message)
  process.exit(1)
})
