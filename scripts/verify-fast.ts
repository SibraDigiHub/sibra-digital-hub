// ═══════════════════════════════════════════════════════════
// `npm run verify:fast` — lint, typecheck and unit-only checks
// (target < 1 minute, no servers, no PostgreSQL writes):
//   typecheck (FE + BE, parallel) → lint (BE clean, FE baseline)
//   → payments unit tests → copy-claims gate.
// Writes reports/verify-local-<ts>.md. Exit non-zero on failure.
// ═══════════════════════════════════════════════════════════

import { spawnSync } from 'bun'
import { join } from 'node:path'
import { writeReport, type Check, pass, fail } from './_lib'

const ROOT = join(import.meta.dir, '..')
const FE = join(ROOT, 'frontend')
const BE = join(ROOT, 'backend')

const FE_LINT_BASELINE: Record<string, number> = {
  'src/components/admin/AdminActivity.tsx': 1,
  'src/components/admin/AdminOrders.tsx': 1,
  'src/components/admin/AdminProducts.tsx': 1,
  'src/components/admin/AdminSystem.tsx': 1,
  'src/components/shop/CatalogEngine.tsx': 1,
  'src/components/shop/ThankYouView.tsx': 1,
}

function run(step: string, cmd: string[], cwd: string): { out: string; code: number; ms: number } {
  const started = Date.now()
  const proc = spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  return { out: new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr), code: proc.exitCode ?? 1, ms: Date.now() - started }
}

function parseFeLint(output: string): { counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {}
  let current: string | null = null
  let total = 0
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    const fileMatch = line.match(/^\/.*\/frontend\/(src\/.+?\.(?:tsx|ts))$/)
    if (fileMatch) {
      current = fileMatch[1]
      continue
    }
    if (/^\s*\d+:\d+\s+error\b/.test(line) && current) {
      counts[current] = (counts[current] ?? 0) + 1
      total += 1
    }
  }
  return { counts, total }
}

async function main(): Promise<void> {
  const checks: Check[] = []
  const push = (step: string, ok: boolean, detail: string, ms: number): void => {
    checks.push(ok ? pass(step, step, `${detail} (${(ms / 1000).toFixed(1)}s)`, ms) : fail(step, step, `${detail} (${(ms / 1000).toFixed(1)}s)`, ms))
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${step} — ${detail}`)
  }

  const [feTc, beTc] = await Promise.all([
    new Promise<{ code: number; out: string; ms: number }>((resolve) => resolve(run('typecheck:frontend', ['bun', 'run', 'typecheck'], FE))),
    new Promise<{ code: number; out: string; ms: number }>((resolve) => resolve(run('typecheck:backend', ['bun', 'run', 'typecheck'], BE))),
  ])
  push('typecheck:frontend', feTc.code === 0, feTc.code === 0 ? 'passed' : feTc.out.slice(0, 150), feTc.ms)
  push('typecheck:backend', beTc.code === 0, beTc.code === 0 ? 'passed' : beTc.out.slice(0, 150), beTc.ms)

  const beLint = run('lint:backend', ['bun', 'run', 'lint'], BE)
  push('lint:backend (must be clean)', beLint.code === 0, beLint.code === 0 ? 'clean' : beLint.out.slice(0, 150), beLint.ms)
  const feLint = run('lint:frontend', ['bun', 'run', 'lint'], FE)
  const parsed = parseFeLint(feLint.out)
  const baselineOk = feLint.code === 0 || (parsed.total === Object.values(FE_LINT_BASELINE).reduce((a, b) => a + b, 0) && JSON.stringify(parsed.counts) === JSON.stringify(FE_LINT_BASELINE))
  push('lint:frontend (baseline)', baselineOk, baselineOk ? `${parsed.total} documented pre-existing errors` : `baseline drift: ${JSON.stringify(parsed.counts)}`, feLint.ms)

  const unit = run('test:payments:unit', ['bun', 'test', 'tests/payments/unit.test.ts'], BE)
  push('payments unit tests', unit.code === 0, unit.code === 0 ? 'passed' : unit.out.slice(0, 150), unit.ms)

  const copy = run('check-copy-claims', ['bun', 'scripts/check-copy-claims.ts'], FE)
  push('copy-claims', copy.code === 0, copy.code === 0 ? 'no forbidden or inconsistent claims' : copy.out.slice(0, 300), copy.ms)

  console.log(`\nverify:fast — ${checks.filter((c) => c.ok).length}/${checks.length} passed`)
  writeReport('local', 'Fast verify (lint/typecheck/unit/copy)', checks)
  if (checks.some((c) => !c.ok)) process.exit(1)
}

main()
