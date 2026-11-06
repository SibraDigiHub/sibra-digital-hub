// ═══════════════════════════════════════════════════════════
// TOTP disable regression — disabling the authenticator app
// from settings must clear the recovery codes generated with
// it. Otherwise factorCount() stays > 0 and the next admin
// login is trapped on the PENDING_2FA "6-digit code" step that
// can never verify (TOTP is off).
//   • enroll → confirm ⇒ totpEnabled + 10 recovery codes
//   • disableTotp ⇒ totp off, secret gone, recovery codes gone
//   • factorCount == 0 ⇒ HTTP login answers stage FULL
//     (dev posture, ADMIN_REQUIRE_2FA=false)
// Destructive (creates one fixture admin + sessions) → guarded
// by tests/_guard.ts. Needs the dev backend on :3001.
// ═══════════════════════════════════════════════════════════

import { describe, test, afterAll } from 'bun:test'
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib'

import './_guard-wrapper'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { disableTotp, confirmTotpEnrollment, startTotpEnrollment, factorCount } from '@/services/admin-auth-service'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3001'
const KEY = process.env.INTERNAL_API_KEY ?? ''
const LABEL = `security-totp-disable-${Date.now()}`
const ADMIN_EMAIL = `${LABEL}@sibra.local`
const PASSWORD = 'TotpDisableProbe!2026x'

// Same parameters as backend/src/lib/auth/totp.ts — generates the
// live code a real authenticator app would show right now.
const probe = new TOTP({
  digits: 6,
  period: 30,
  algorithm: 'sha1',
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
})

async function currentCode(secret: string): Promise<string> {
  const epoch = Math.floor(Date.now() / 1000 / 30) * 30
  return String(await probe.generate({ secret, epoch }))
}

async function httpLogin(): Promise<{ status: number; stage?: string }> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { 'x-internal-key': KEY } : {}) },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
  })
  const body = (await res.json().catch(() => ({}))) as { stage?: string }
  return { status: res.status, stage: body.stage }
}

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${evidence}`)
}

async function cleanup(): Promise<void> {
  const admin = await db.adminUser.findUnique({ where: { email: ADMIN_EMAIL } })
  if (admin) {
    await db.adminSession.deleteMany({ where: { adminId: admin.id } })
    await db.adminUser.delete({ where: { id: admin.id } })
  }
  await db.auditLog.deleteMany({ where: { label: { contains: LABEL } } })
}

afterAll(async () => {
  await cleanup()
  console.log(`TOTP DISABLE: ${failures === 0 ? 'all checks passed' : `${failures} failure(s)`}`)
  if (failures > 0) process.exitCode = 1
})

describe('totp disable clears recovery codes', () => {
  test('disableTotp removes totp + secret + recovery codes; login then skips 2FA', async () => {
    const passwordHash = await hashPassword(PASSWORD)
    const created = await db.adminUser.create({
      data: { email: ADMIN_EMAIL, passwordHash, totpEnabled: false, failedLogins: 0 },
    })

    // Enroll: start → confirm with a live code → recovery codes issued once.
    const enrollSession = await createSession({ adminId: created.id, stage: 'FULL', ip: '127.0.0.1', ua: 'totp-disable-probe' })
    const started = await startTotpEnrollment(enrollSession.session, created, '127.0.0.1')
    // Re-fetch: startTotpEnrollment persisted the encrypted secret — service
    // calls need the fresh row, not this file's stale in-memory copy.
    const enrolled = await db.adminUser.findUniqueOrThrow({ where: { id: created.id } })
    const confirmed = await confirmTotpEnrollment(enrollSession.session, enrolled, await currentCode(started.secret), '127.0.0.1')
    check('enroll issues 10 recovery codes', (confirmed.recoveryCodes?.length ?? 0) === 10, `${confirmed.recoveryCodes?.length ?? 0} codes`)

    const enabled = await db.adminUser.findUniqueOrThrow({ where: { id: created.id } })
    check('2FA active after enroll (factorCount 11)', (await factorCount(enabled)) === 11, `factorCount=${await factorCount(enabled)}`)
    const gated = await httpLogin()
    check('login gated on PENDING_2FA while 2FA on', gated.status === 200 && gated.stage === 'PENDING_2FA', `status=${gated.status} stage=${gated.stage ?? 'n/a'}`)

    // Disable from settings (step-up password) — the user's exact action.
    const fullSession = await createSession({ adminId: created.id, stage: 'FULL', ip: '127.0.0.1', ua: 'totp-disable-probe' })
    await disableTotp(fullSession.session, enabled, PASSWORD, '127.0.0.1')

    const disabled = await db.adminUser.findUniqueOrThrow({ where: { id: created.id } })
    check('totpEnabled false after disable', disabled.totpEnabled === false, `totpEnabled=${disabled.totpEnabled}`)
    check('totp secret removed after disable', disabled.totpSecretEnc === null, `secret=${disabled.totpSecretEnc === null ? 'null' : 'present'}`)
    check('recovery codes cleared after disable', disabled.recoveryCodeHashes.length === 0, `${disabled.recoveryCodeHashes.length} hashes left`)
    check('factorCount 0 after disable', (await factorCount(disabled)) === 0, `factorCount=${await factorCount(disabled)}`)

    // THE regression: next login must NOT demand a 6-digit code.
    const final = await httpLogin()
    check('login answers stage FULL after disable (bug fix)', final.status === 200 && final.stage === 'FULL', `status=${final.status} stage=${final.stage ?? 'n/a'}`)
  }, 60_000)
})
