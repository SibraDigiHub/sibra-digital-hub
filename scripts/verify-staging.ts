// ═══════════════════════════════════════════════════════════
// `npm run verify:staging` — verification against a STAGING
// deployment (Razorpay TEST keys / PayPal SANDBOX):
//   1. smoke verifier  --env staging   (read-only + safe negatives)
//   2. db-integrity against STAGING_DATABASE_URL (read-only SELECT)
//   3. payments-sandbox-assist --guided (prints the manual test
//      matrix — the mutating payment steps stay manual on purpose)
//
// Required env: FRONTEND_URL, BACKEND_URL (https), and optionally
// STAGING_DATABASE_URL. See docs/TESTING.md. Writes a report to
// reports/verify-staging-<ts>.md; exit non-zero on failures.
// ═══════════════════════════════════════════════════════════

import { spawnSync } from 'bun'
import { join } from 'node:path'
import { writeReport, type Check, pass, fail } from './_lib'

const ROOT = join(import.meta.dir, '..')

function run(title: string, cmd: string[], env: Record<string, string>): { code: number; out: string } {
  console.log(`\n──── ${title} ────`)
  const proc = spawnSync(cmd, { cwd: ROOT, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr)
  console.log(out)
  return { code: proc.exitCode ?? 1, out }
}

async function main(): Promise<void> {
  const checks: Check[] = []
  for (const v of ['FRONTEND_URL', 'BACKEND_URL']) {
    if (!process.env[v]) {
      console.error(`verify:staging — ${v} must be set (https staging URL, see docs/TESTING.md).`)
      process.exit(1)
    }
  }

  const smoke = run('smoke --env staging', ['bun', 'scripts/smoke.ts', '--env', 'staging'], {})
  checks.push(smoke.code === 0 ? pass('smoke staging', 'smoke staging', 'all checks passed') : fail('smoke staging', 'smoke staging', `exit ${smoke.code}`))

  if (process.env.STAGING_DATABASE_URL) {
    const integrity = run('db-integrity (staging, read-only)', ['bun', 'scripts/db-integrity.ts', '--db', process.env.STAGING_DATABASE_URL, '--since', '168h'], {})
    checks.push(integrity.code === 0 ? pass('db-integrity staging', 'db-integrity staging (read-only)', 'no critical invariants violated') : fail('db-integrity staging', 'db-integrity staging (read-only)', `exit ${integrity.code}`))
  } else {
    checks.push(pass('db-integrity staging', 'db-integrity staging (read-only)', 'skipped — STAGING_DATABASE_URL not set'))
  }

  // Guided mode prints the manual matrix only — it never mutates anything,
  // so the runner may confirm it on the operator's behalf. The mutating
  // assist modes (--verify / --replay-razorpay / --lost-webhook) are NOT
  // wired here; the owner runs them explicitly (docs/TESTING.md).
  const assist = run('payments matrix (guided)', ['bun', 'scripts/payments-sandbox-assist.ts', '--guided'], { STAGING_CONFIRM: 'yes', FRONTEND_URL: process.env.FRONTEND_URL ?? '', BACKEND_URL: process.env.BACKEND_URL ?? '' })
  checks.push(assist.code === 0 ? pass('payments matrix', 'payments matrix (guided print-out)', 'printed') : fail('payments matrix', 'payments matrix (guided print-out)', `exit ${assist.code}`))

  console.log(`\nverify:staging — ${checks.filter((c) => c.ok).length}/${checks.length} passed`)
  writeReport('staging', 'Staging verification', checks)
  if (checks.some((c) => !c.ok)) process.exit(1)
}

main()
