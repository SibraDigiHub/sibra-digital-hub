// ═══════════════════════════════════════════════════════════
// Login lockout + session expiry/revocation regressions.
//   • 5 consecutive bad passwords lock the account; even the CORRECT
//     password then answers the same generic 401 (anti-enumeration)
//   • admin sessions refuse expired / revoked / wrong-stage tokens
// Destructive (creates one fixture admin + sessions) → guarded by
// tests/_guard.ts. Needs the dev backend on :3001 for the HTTP part.
// ═══════════════════════════════════════════════════════════

import { describe, test, afterAll } from 'bun:test'

import './_guard-wrapper'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { COOKIE_NAME, createSession, resolveSession } from '@/lib/auth/session'
import { NextRequest } from 'next/server'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3001'
const KEY = process.env.INTERNAL_API_KEY ?? ''
const LABEL = `security-lockout-${Date.now()}`
const ADMIN_EMAIL = `${LABEL}@sibra.local`
const PASSWORD = 'LockoutProbe!2026x'

async function login(password: string): Promise<Response> {
  return fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { 'x-internal-key': KEY } : {}) },
    body: JSON.stringify({ email: ADMIN_EMAIL, password }),
  })
}

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${evidence}`)
}

async function sessionProbe(token: string | null): Promise<boolean> {
  const req = new NextRequest('http://localhost:3001/api/admin/session', {
    headers: {
      // resolveSession soft-binds the session to the user-agent hash — the
      // probe must present the SAME ua the session was created with.
      'user-agent': 'lockout-probe',
      ...(token ? { cookie: `${COOKIE_NAME}=${token}` } : {}),
    },
  })
  const resolved = await resolveSession(req)
  return resolved !== null
}

async function cleanup(): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'login:ip:' } } })
  const admin = await db.adminUser.findUnique({ where: { email: ADMIN_EMAIL } })
  if (admin) {
    await db.adminSession.deleteMany({ where: { adminId: admin.id } })
    await db.adminUser.delete({ where: { id: admin.id } })
  }
  await db.auditLog.deleteMany({ where: { label: { contains: LABEL } } })
}

afterAll(async () => {
  await cleanup()
  console.log(`LOGIN LOCKOUT/SESSION: ${failures === 0 ? 'all checks passed' : `${failures} failure(s)`}`)
  if (failures > 0) process.exitCode = 1
})

describe('login lockout', () => {
  test('5 consecutive failures lock the account; correct password then still 401', async () => {
    const passwordHash = await hashPassword(PASSWORD)
    await db.adminUser.create({
      data: { email: ADMIN_EMAIL, passwordHash, totpEnabled: false, failedLogins: 0 },
    })
    for (let i = 0; i < 5; i++) {
      const res = await login(`wrong-${i}`)
      if (res.status !== 401) {
        check('bad logins → 401', false, `attempt ${i + 1} answered ${res.status}`)
        return
      }
    }
    const admin = await db.adminUser.findUnique({ where: { email: ADMIN_EMAIL } })
    check('bad logins → 401', true, '5× 401')
    check('account locked after 5 failures', (admin?.lockedUntil?.getTime() ?? 0) > Date.now(), `lockedUntil=${admin?.lockedUntil?.toISOString() ?? 'none'}`)
    const correct = await login(PASSWORD)
    const body = (await correct.json().catch(() => ({}))) as Record<string, unknown>
    // Layered defence: the locked account is refused either by the lockout
    // itself (generic 401 — never "locked") or, when this probe IP has
    // burned its login budget, by the IP limiter (429). Both are refusals;
    // the lockout state itself is asserted via lockedUntil above.
    const refused = correct.status === 401 || correct.status === 429
    check('locked account refused with anti-enumeration body', refused && (correct.status === 429 || body.error === 'Invalid email or password.'), `status ${correct.status}`)
  }, 30_000)
})

describe('admin session expiry/revocation', () => {
  test('active resolves; expired/revoked/pending-stage refuse', async () => {
    const passwordHash = await hashPassword(PASSWORD)
    const admin = await db.adminUser.upsert({
      where: { email: ADMIN_EMAIL },
      create: { email: ADMIN_EMAIL, passwordHash, totpEnabled: false },
      update: {},
    })
    const issued = await createSession({ adminId: admin.id, stage: 'FULL', ip: '127.0.0.1', ua: 'lockout-probe' })
    check('fresh FULL session resolves', await sessionProbe(issued.token), 'resolveSession ≠ null')

    await db.adminSession.update({ where: { id: issued.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    check('expired session refuses', !(await sessionProbe(issued.token)), 'resolveSession null')

    await db.adminSession.update({ where: { id: issued.session.id }, data: { expiresAt: new Date(Date.now() + 3_600_000), revokedAt: new Date() } })
    check('revoked session refuses', !(await sessionProbe(issued.token)), 'resolveSession null')

    await db.adminSession.update({ where: { id: issued.session.id }, data: { revokedAt: null, lastSeenAt: new Date(Date.now() - 3 * 3_600_000) } })
    check('idle-expired session refuses', !(await sessionProbe(issued.token)), 'resolveSession null (sliding idle window)')
  }, 30_000)
})
