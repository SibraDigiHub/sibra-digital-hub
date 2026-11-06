// ═══════════════════════════════════════════════════════════
// Production boot-guard matrix — ADDITIONS beyond t7-verify.ts
// (do not duplicate t7's cases; this covers the gaps):
//   • missing CRON_SECRET refuses (cron routes would be unauthenticated)
//   • EMAIL_PROVIDER=resend without RESEND_API_KEY refuses
//   • weak (short) SESSION_PEPPER refuses
//   • ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true + RAZORPAY_MODE=test BOOTS
//     (the documented staging posture)
// Each case spawns `bun -e "import src/config/env"` with a crafted env,
// exactly like t7's bootGuard. No server needed.
// ═══════════════════════════════════════════════════════════

import { describe, test } from 'bun:test'

import { join } from 'node:path'

const HERE = import.meta.dir
const b64_32 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')

function bootGuard(extra: Record<string, string>): { threw: boolean; msg: string } {
  const good: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/sibra',
    ENCRYPTION_KEY: b64_32,
    SESSION_PEPPER: b64_32,
    PUBLIC_WEB_URL: 'https://example.com',
    INTERNAL_API_KEY: 'boot-guard-internal-key-0123456789',
    ADMIN_REQUIRE_2FA: 'true',
    ADMIN_PASSKEYS_ENABLED: 'false',
    CRON_SECRET: 'boot-guard-cron-0123456789',
    DEMO_MODE: '',
  }
  const proc = Bun.spawnSync(['bun', '-e', `await import('${join(HERE, '../../src/config/env.ts')}'); console.log('BOOTED OK')`], {
    cwd: join(HERE, '../..'),
    env: { ...process.env, ...good, ...extra },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const msg = new TextDecoder().decode(proc.stderr) + new TextDecoder().decode(proc.stdout)
  return { threw: proc.exitCode !== 0, msg }
}

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${firstLine(evidence)}`)
}
function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0)?.slice(0, 110) ?? ''
}

describe('production boot-guard additions', () => {
  test('missing CRON_SECRET refuses', () => {
    const r = bootGuard({ CRON_SECRET: '' })
    check('missing CRON_SECRET refuses', r.threw && r.msg.includes('CRON_SECRET'), r.msg)
  })

  test('EMAIL_PROVIDER=resend without RESEND_API_KEY refuses', () => {
    const r = bootGuard({ EMAIL_PROVIDER: 'resend' })
    check('resend without key refuses', r.threw && r.msg.toLowerCase().includes('resend'), r.msg)
  })

  test('short SESSION_PEPPER refuses', () => {
    const r = bootGuard({ SESSION_PEPPER: 'too-short-pepper' })
    check('short SESSION_PEPPER refuses', r.threw && r.msg.includes('SESSION_PEPPER'), r.msg)
  })

  test('RAZORPAY_MODE=test + ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true boots (staging posture)', () => {
    const r = bootGuard({ ALLOW_TEST_PAYMENTS_IN_PRODUCTION: 'true', RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_0123456789abcdef', RAZORPAY_KEY_SECRET: 'k'.repeat(24), RAZORPAY_WEBHOOK_SECRET: 'staging-webhook-secret-0123456789', RESEND_API_KEY: 'staging-resend-key-0123456789abcdef' })
    check('staging posture boots', !r.threw && r.msg.includes('BOOTED OK'), r.msg)
  })
})
