// ═══════════════════════════════════════════════════════════
// Download contract regression (HTTP, end-to-end):
//   GET  ×10 → always 200 and NEVER consumes a download
//   POST ×5  → exactly 5 claims succeed, the 6th is refused 429
//   final downloadCount in DB === DOWNLOAD_MAX_DEFAULT (5)
// Destructive (creates one order via the real checkout) → guarded by
// tests/_guard.ts. Needs the dev backend (:3001) in DEMO_MODE and
// INTERNAL_API_KEY; cleans up its order + logs afterwards.
// (t5-verify covers claim CONCURRENCY; this locks the GET-vs-POST
// semantics of the public contract.)
// ═══════════════════════════════════════════════════════════

import { describe, test, afterAll, beforeAll } from 'bun:test'

import './_guard-wrapper'
import { db } from '@/lib/db'
import { fulfillOrder } from '@/services/order-service'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3001'
const KEY = process.env.INTERNAL_API_KEY ?? ''
const MAX_DOWNLOADS = Number(process.env.DOWNLOAD_MAX_DEFAULT ?? 5)

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${evidence}`)
}

// The dev backend may run with test-mode Razorpay keys (test:payments needs
// them) whose RAZORPAY_API_BASE points at the shared mock port :3010.
// Spawn our own mock instance so checkout/create reaches a live mock in any
// suite order. Harmless when the backend is key-less (demo path, unused).
let mockProc: Bun.Subprocess | null = null
const MOCK_BASE = 'http://127.0.0.1:3010'
beforeAll(async () => {
  mockProc = Bun.spawn(['bun', 'tests/mock-razorpay-server.ts'], {
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env, MOCK_RAZORPAY_PORT: '3010' },
  })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${MOCK_BASE}/__mock__/reset`, { method: 'POST' })).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
})

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(KEY ? { 'x-internal-key': KEY } : {}), ...(init.headers ?? {}) },
  })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    /* redirects / empty bodies */
  }
  return { status: res.status, body, headers: res.headers }
}

afterAll(async () => {
  // Sweep tracked fixtures + ANY leftover @sibra.local order (a failed
  // mid-loop test would otherwise leak one per run).
  const tracked = await db.order.findMany({ where: { visitorId: { startsWith: 'security-dl-' } }, select: { id: true } })
  const swept = await db.order.findMany({ where: { customerEmail: { endsWith: '@sibra.local' } }, select: { id: true } })
  const ids = [...new Set([...tracked, ...swept].map((o) => o.id))]
  await db.emailOutbox.deleteMany({ where: { orderId: { in: ids } } })
  await db.emailLog.deleteMany({ where: { orderId: { in: ids } } })
  await db.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
  await db.activityEvent.deleteMany({ where: { orderId: { in: ids } } })
  await db.order.deleteMany({ where: { id: { in: ids } } })
  await db.idempotencyKey.deleteMany({ where: { key: { startsWith: 'security-dl-' } } })
  console.log(`DOWNLOAD CONTRACT: ${failures === 0 ? 'all checks passed' : `${failures} failure(s)`} (cleaned ${ids.length} fixture order(s))`)
  mockProc?.kill()
  mockProc = null
  if (failures > 0) process.exitCode = 1
})

describe('download contract: GET never consumes, POST claims up to the cap', () => {
  test('10× GET free, exactly N POST claims, N+1 refused', async () => {
    const products = await api('/api/products')
    const list = (products.body as { products?: Array<Record<string, unknown>> }).products ?? []
    const instant = list.find((p) => p.instantDownload === true)
    if (!instant) throw new Error('no instant-download product available')

    const idemKey = `security-dl-${crypto.randomUUID()}`
    const created = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey },
      body: JSON.stringify({ productId: instant.id, customerName: 'DL Contract', customerEmail: 'dl-contract@sibra.local', country: 'IN', consent: true }),
    })
    if (created.status !== 201) throw new Error(`checkout create failed: ${created.status}`)
    const orderId = (created.body.order as { id: string }).id
    await db.order.update({ where: { id: orderId }, data: { visitorId: 'security-dl-fixture' } })
    const claimValue = /__Host-sdh_claim=([^;]+)/.exec(created.headers.get('set-cookie') ?? '')?.[1] ?? ''

    // Fulfil in-process through the shared service — the exact call demo-pay
    // makes. The HTTP demo-pay route is intentionally NOT used here: it 409s
    // on key-configured backends (which test:payments requires), and this
    // suite must pass in both postures (demo key-less and test-keyed).
    const fulfilled = await fulfillOrder(orderId)
    if (fulfilled.outcome !== 'fulfilled' || !fulfilled.token) {
      throw new Error(`in-process fulfil failed: ${fulfilled.outcome}`)
    }
    const token = fulfilled.token

    // 1) GET ×10 — validate-only, never consumes
    let freeGets = 0
    for (let i = 0; i < 10; i++) {
      const res = await api(`/api/download/${token}?mode=json`, { method: 'GET' })
      if (res.status === 200) freeGets += 1
    }
    const afterGets = await db.order.findUnique({ where: { id: orderId }, select: { downloadCount: true } })
    check('10× GET all validate OK', freeGets === 10, `${freeGets}/10`)
    check('GETs never consumed', afterGets?.downloadCount === 0, `downloadCount=${afterGets?.downloadCount}`)

    // 2) POST ×N — the claims; N+1 refused
    let claims = 0
    let lastStatus = 0
    for (let i = 0; i < MAX_DOWNLOADS; i++) {
      const res = await api(`/api/download/${token}?mode=json`, { method: 'POST' })
      if (res.status === 200) claims += 1
      lastStatus = res.status
    }
    const refused = await api(`/api/download/${token}?mode=json`, { method: 'POST' })
    const final = await db.order.findUnique({ where: { id: orderId }, select: { downloadCount: true } })
    check(`POST claims succeed exactly ${MAX_DOWNLOADS}×`, claims === MAX_DOWNLOADS, `claims=${claims} last=${lastStatus}`)
    check(`${MAX_DOWNLOADS + 1}th claim refused 429`, refused.status === 429, `status ${refused.status}`)
    check(`downloadCount settles at ${MAX_DOWNLOADS}`, final?.downloadCount === MAX_DOWNLOADS, `downloadCount=${final?.downloadCount}`)
  }, 60_000)
})
