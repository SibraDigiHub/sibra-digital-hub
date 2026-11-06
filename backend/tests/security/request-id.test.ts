// ═══════════════════════════════════════════════════════════
// #err-logging-blind regression — every response echoes an
// x-request-id (the frontend proxy's correlation id when
// present), and error diagnostics are redacted: no PII
// (emails), no secrets, in log-bound text.
// Pure unit tests — no server, no DB.
// ═══════════════════════════════════════════════════════════
import { describe, expect, test } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, errorLogFields, redactLogText } from '@/lib/api'

function req(pathname: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://127.0.0.1:3001${pathname}`, { headers })
}

describe('x-request-id correlation (every response)', () => {
  test('echoes an incoming x-request-id on success and error paths', async () => {
    const ok = asHandler(async (_req: NextRequest) => NextResponse.json({ ok: true }))
    const resOk = await ok(req('/api/ping', { 'x-request-id': 'test-rid-1234567890' }))
    expect(resOk.headers.get('x-request-id')).toBe('test-rid-1234567890')

    const boom = asHandler(async (_req: NextRequest): Promise<Response> => {
      throw new Error('kaboom')
    })
    const resErr = await boom(req('/api/ping', { 'x-request-id': 'test-rid-1234567890' }))
    expect(resErr.status).toBe(500)
    expect(resErr.headers.get('x-request-id')).toBe('test-rid-1234567890')
  })

  test('generates a fresh id when the header is absent', async () => {
    const ok = asHandler(async (_req: NextRequest) => NextResponse.json({ ok: true }))
    const a = await ok(req('/api/ping'))
    const b = await ok(req('/api/ping'))
    expect(a.headers.get('x-request-id')).toMatch(/^[\w.-]{8,128}$/)
    expect(b.headers.get('x-request-id')).toMatch(/^[\w.-]{8,128}$/)
    expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'))
  })

  test('rejects junk correlation ids (never echoes arbitrary header content)', async () => {
    const ok = asHandler(async (_req: NextRequest) => NextResponse.json({ ok: true }))
    const res = await ok(req('/api/ping', { 'x-request-id': 'spaces and <script>alert(1)</script>' }))
    expect(res.headers.get('x-request-id')).toMatch(/^[\w.-]{8,128}$/)
    expect(res.headers.get('x-request-id')).not.toContain('<')
    expect(res.headers.get('x-request-id')).not.toContain(' ')
  })
})

describe('redactLogText — no PII, no secrets in log-bound text', () => {
  test('masks emails', () => {
    const out = redactLogText('buyer jiten.dev@example.com paid for order x')
    expect(out).not.toContain('jiten.dev@example.com')
    expect(out).toContain('[redacted-email]')
  })

  test('masks secret-shaped assignments (bearer, token=, password=, api_key=)', () => {
    const out = redactLogText(
      'Authorization: Bearer rzp_live_secret123; token="abc123"; password: hunter2; api_key=AKIAIOSFODNN7',
    )
    expect(out).not.toContain('rzp_live_secret123')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('AKIAIOSFODNN7')
    expect(out.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(5)
  })

  test('leaves ordinary messages untouched', () => {
    const msg = 'Order cmxyz123 cannot be fulfilled — status failed'
    expect(redactLogText(msg)).toBe(msg)
  })

  test('redacted stack stays bounded (first 8 lines only)', () => {
    const err = new Error('deep failure for buyer hidden@example.com')
    const stack = redactLogText(err.stack ?? '')
    expect(stack.split('\n').length).toBeLessThanOrEqual(8)
    expect(stack).not.toContain('hidden@example.com')
  })

  test('errorLogFields — the unhandled-error log line carries message, route, requestId, redacted stack', () => {
    const fields = errorLogFields(
      new Error('Prisma exploded for buyer hidden@example.com token=abc123'),
      req('/api/admin/orders/watch', { 'x-request-id': 'rid-in-log-12345' }),
      'rid-in-log-12345',
    )
    const json = JSON.stringify(fields)
    expect(fields.requestId).toBe('rid-in-log-12345')
    expect(fields.route).toBe('GET /api/admin/orders/watch')
    expect(String((fields.err as { message: string }).message)).not.toContain('hidden@example.com')
    expect(json).not.toContain('abc123')
    expect(typeof fields.stack).toBe('string')
    expect((fields.stack as string).split('\n').length).toBeLessThanOrEqual(8)
    // Non-Error throws are stringified, not passed through as opaque objects
    const weird = errorLogFields({ anything: true }, null, 'rid-plain-00001')
    expect(typeof (weird.err as { message: string }).message).toBe('string')
    expect(weird.route).toBe('unknown')
  })
})
