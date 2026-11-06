// ═══════════════════════════════════════════════════════════
// `npm run verify:prod` — STRICTLY READ-ONLY production check.
//   1. smoke verifier --env prod (GET/HEAD + safe negative POSTs
//      only — no orders, no claims, no data touched; asserts the
//      production posture: demoMode:false, testPaymentsAllowed:false)
//   2. db-integrity against PROD_READONLY_DATABASE_URL if provided —
//      SELECT-only; run it with a read-only database role.
// The payment sandbox assistant is HARD-BLOCKED in prod mode.
// Required env: FRONTEND_URL, BACKEND_URL (https). Writes a report
// to reports/verify-prod-<ts>.md; exit non-zero on failures.
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
      console.error(`verify:prod — ${v} must be set (https production URL, see docs/TESTING.md).`)
      process.exit(1)
    }
  }
  if (process.env.STAGING_CONFIRM === 'yes') {
    console.error('verify:prod — STAGING_CONFIRM must NOT be set for a production run (this runner is read-only).')
    process.exit(1)
  }

  const smoke = run('smoke --env prod', ['bun', 'scripts/smoke.ts', '--env', 'prod'], {})
  checks.push(smoke.code === 0 ? pass('smoke prod', 'smoke prod (read-only + safe negatives)', 'all checks passed') : fail('smoke prod', 'smoke prod (read-only + safe negatives)', `exit ${smoke.code}`))

  if (process.env.PROD_READONLY_DATABASE_URL) {
    const integrity = run('db-integrity (prod, read-only role)', ['bun', 'scripts/db-integrity.ts', '--db', process.env.PROD_READONLY_DATABASE_URL, '--since', '168h'], {})
    checks.push(integrity.code === 0 ? pass('db-integrity prod', 'db-integrity prod (SELECT-only)', 'no critical invariants violated') : fail('db-integrity prod', 'db-integrity prod (SELECT-only)', `exit ${integrity.code}`))
  } else {
    checks.push(pass('db-integrity prod', 'db-integrity prod (SELECT-only)', 'skipped — PROD_READONLY_DATABASE_URL not set'))
  }

  checks.push(pass('payments assist', 'payment assist', 'blocked by design in prod mode — payments are verified manually against the live dashboards'))

  console.log(`\nverify:prod — ${checks.filter((c) => c.ok).length}/${checks.length} passed`)
  writeReport('prod', 'Production verification (read-only)', checks)
  if (checks.some((c) => !c.ok)) process.exit(1)
}

main()
