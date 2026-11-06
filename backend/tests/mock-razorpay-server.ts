// ═══════════════════════════════════════════════════════════
// Local mock Razorpay server (TEST-ONLY) — implements just the
// Orders-API surface the backend uses, on a fixed port so the
// dev backend (RAZORPAY_API_BASE) and the payment test suites
// share ONE mock exactly the way production shares the real API.
//
//   POST /v1/orders                    create an order (stored in memory)
//   GET  /v1/orders/:id                fetch an order
//   GET  /v1/orders/:id/payments       fetch an order's payments
//   GET  /v1/payments/:id              fetch a payment (any order)
//   POST /__mock__/pay                 TEST HOOK: attach a payment to an order
//   POST /__mock__/reset               TEST HOOK: clear all state
//   POST /__mock__/fail-next           TEST HOOK: next create answers `status`
//
// No secrets live here: signatures are computed by the CALLERS
// (tests hold the same KEY_SECRET / WEBHOOK_SECRET the backend uses).
// Run: bun tests/mock-razorpay-server.ts   (port 3010)
// ═══════════════════════════════════════════════════════════

interface MockOrder {
  id: string
  amount: number
  currency: string
  receipt: string
  notes: Record<string, string>
  status: string
  createdAt: number
}

interface MockPayment {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
  method: string
  international: boolean
}

const orders = new Map<string, MockOrder>()
const payments = new Map<string, MockPayment>()
let failNext: { status: number; times: number } | null = null

const json = (data: unknown, status = 200) => Response.json(data, { status })

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

Bun.serve({
  port: Number(process.env.MOCK_RAZORPAY_PORT ?? 3010),
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url)
    const { pathname } = url

    // ── Test hooks ──────────────────────────────────────────
    if (pathname === '/__mock__/reset' && req.method === 'POST') {
      orders.clear()
      payments.clear()
      failNext = null
      return json({ ok: true })
    }
    if (pathname === '/__mock__/fail-next' && req.method === 'POST') {
      const body = await readBody(req)
      failNext = { status: Number(body.status ?? 500), times: Math.max(1, Number(body.times ?? 1)) }
      return json({ ok: true })
    }
    if (pathname === '/__mock__/pay' && req.method === 'POST') {
      const body = await readBody(req)
      const orderId = String(body.orderId ?? '')
      const order = orders.get(orderId)
      if (!order) return json({ error: 'unknown order' }, 404)
      const payment: MockPayment = {
        id: String(body.paymentId ?? `pay_mock_${crypto.randomUUID().slice(0, 12)}`),
        order_id: orderId,
        amount: Number(body.amount ?? order.amount),
        currency: String(body.currency ?? order.currency),
        status: String(body.status ?? 'captured'),
        method: String(body.method ?? 'upi'),
        international: Boolean(body.international ?? false),
      }
      payments.set(payment.id, payment)
      if (payment.status === 'captured') order.status = 'attempted'
      return json(payment)
    }

    // ── Orders API surface ─────────────────────────────────
    if (pathname === '/v1/orders' && req.method === 'POST') {
      if (failNext && failNext.times > 0) {
        const status = failNext.status
        failNext.times -= 1
        if (failNext.times <= 0) failNext = null
        return json({ error: { description: `mock failure ${status}` } }, status)
      }
      const body = await readBody(req)
      const order: MockOrder = {
        id: `order_mock_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
        amount: Number(body.amount ?? 0),
        currency: String(body.currency ?? 'INR'),
        receipt: String(body.receipt ?? ''),
        notes: (body.notes as Record<string, string>) ?? {},
        status: 'created',
        createdAt: Date.now(),
      }
      orders.set(order.id, order)
      return json({ id: order.id, status: order.status, amount: order.amount, currency: order.currency, receipt: order.receipt, notes: order.notes })
    }
    const orderMatch = /^\/v1\/orders\/([^/]+)\/payments$/.exec(pathname)
    if (orderMatch && req.method === 'GET') {
      const id = decodeURIComponent(orderMatch[1])
      if (!orders.has(id)) return json({ error: { description: 'order not found' } }, 404)
      const items = [...payments.values()].filter((p) => p.order_id === id)
      return json({ items })
    }
    const orderGet = /^\/v1\/orders\/([^/]+)$/.exec(pathname)
    if (orderGet && req.method === 'GET') {
      const id = decodeURIComponent(orderGet[1])
      const order = orders.get(id)
      if (!order) return json({ error: { description: 'order not found' } }, 404)
      return json({ id: order.id, status: order.status, amount: order.amount, currency: order.currency, receipt: order.receipt, notes: order.notes })
    }
    const paymentGet = /^\/v1\/payments\/([^/]+)$/.exec(pathname)
    if (paymentGet && req.method === 'GET') {
      const id = decodeURIComponent(paymentGet[1])
      const payment = payments.get(id)
      if (!payment) return json({ error: { description: 'payment not found' } }, 404)
      return json(payment)
    }

    return new Response('mock 404', { status: 404 })
  },
})

console.log(`[mock-razorpay] listening on :${Number(process.env.MOCK_RAZORPAY_PORT ?? 3010)}`)
