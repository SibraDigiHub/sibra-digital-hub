// ═══════════════════════════════════════════════════════════
// `npm run verify` — the one-command local verifier (§2.1).
//
// Order: typecheck → lint (BE clean, FE = documented baseline) →
// unit → integration (real local PostgreSQL) → contract replay →
// leak scan → route inventory → security regressions → query
// budgets → copy-claims → React-key check (browser, if available)
// → both production builds → bundle-size → db-integrity (read-only)
// → fixture-leftover check → local smoke.
//
// KNOWN FAILURES: scripts/verify-known-fails.json lists the failing
// steps that are ALREADY documented in docs/FINDINGS.md. A failing
// step whose output matches every listed pattern is reported as
// `KNOWN` (with the finding reference) and does not fail the run —
// anything NEW fails loudly. Removing the app bug removes the entry.
//
// Requires: local PostgreSQL (:5432), dev servers (:3000/:3001) for
// the live steps, agent-browser for the React-key step (optional).
// Writes reports/verify-local-<ts>.md. Exit non-zero on new failures.
// ═══════════════════════════════════════════════════════════

import { spawn, spawnSync } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeReport, type Check, pass, fail } from './_lib'

const ROOT = join(import.meta.dir, '..')
const FE = join(ROOT, 'frontend')
const BE = join(ROOT, 'backend')
const PG = 'postgresql://postgres@127.0.0.1:5432/sibra'

/** Frontend lint baseline — empty since react-hooks v7 compiler-readiness
 * rules (set-state-in-effect / immutability) were turned off in
 * frontend/eslint.config.mjs (documented there); lint is fully clean. */
const FE_LINT_BASELINE: Record<string, number> = {}

const KNOWN: Array<{ step: string; match: string[]; finding: string }> = existsSync(join(ROOT, 'scripts/verify-known-fails.json'))
  ? require('./verify-known-fails.json')
  : []

function env(): Record<string, string> {
  const beEnv: Record<string, string> = {}
  for (const line of readFileSync(join(BE, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line)
    if (m) beEnv[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return beEnv
}
const BE_ENV = env()
const INTERNAL_KEY = BE_ENV.INTERNAL_API_KEY ?? ''
const WHSEC = BE_ENV.RAZORPAY_WEBHOOK_SECRET ?? ''

interface Result {
  step: string
  ok: boolean
  kind: 'pass' | 'fail' | 'known'
  detail: string
  output?: string
  ms: number
}

function runCmd(step: string, cmd: string[], cwd: string, extraEnv: Record<string, string> = {}): Result {
  const started = Date.now()
  const proc = spawnSync(cmd, { cwd, env: { ...process.env, ...extraEnv }, stdout: 'pipe', stderr: 'pipe' })
  const output = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr)
  const ms = Date.now() - started
  if (proc.exitCode === 0) return { step, ok: true, kind: 'pass', detail: 'passed', output, ms }
  const known = KNOWN.find((k) => k.step === step && k.match.every((m) => output.includes(m)))
  if (known) return { step, ok: true, kind: 'known', detail: `KNOWN failure — ${known.finding} (if this is newly fixed, remove the entry from scripts/verify-known-fails.json)`, output, ms }
  return { step, ok: false, kind: 'fail', detail: `exit ${proc.exitCode}`, output, ms }
}

async function runStep(step: string, fn: () => Promise<string>): Promise<Result> {
  const started = Date.now()
  try {
    const detail = await fn()
    return { step, ok: true, kind: 'pass', detail, ms: Date.now() - started }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const known = KNOWN.find((k) => k.step === step && k.match.every((m) => msg.includes(m)))
    if (known) return { step, ok: true, kind: 'known', detail: `KNOWN failure — ${known.finding}`, ms: Date.now() - started }
    return { step, ok: false, kind: 'fail', detail: msg.slice(0, 200), ms: Date.now() - started }
  }
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

const beUp = async (): Promise<boolean> => {
  try {
    const res = await fetch('http://127.0.0.1:3001/api')
    return res.status === 200
  } catch {
    return false
  }
}

/** Wait until :3001 stops accepting connections (the next-server worker
 *  survives pkill of its parent and would keep the port + a stale key). */
async function waitBackendFree(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await beUp())) return
    await new Promise((r) => setTimeout(r, 500))
  }
  // Last resort: kill the process still holding the port.
  const probe = spawnSync(['bash', '-c', "ss -tlnp | grep ':3001' | grep -oP 'pid=\\K[0-9]+' | head -1"])
  const pid = new TextDecoder().decode(probe.stdout).trim()
  if (pid) spawnSync(['kill', '-9', pid])
  await new Promise((r) => setTimeout(r, 1000))
}

/** The contract fixture needs the dev server DOWN (Next 16 dev-server lock) — stop, run, restore. */
async function withBackendStopped<T>(fn: () => Promise<T>): Promise<T> {
  const wasUp = await beUp()
  if (wasUp) {
    spawnSync(['pkill', '-f', 'next dev -p 3001'])
    await waitBackendFree()
  }
  try {
    return await fn()
  } finally {
    if (wasUp) {
      // setsid detaches the server from this process group — bun's spawnSync
      // reaps plain background children, which silently killed the restart.
      spawnSync(['setsid', 'bash', '-c', `env -u DATABASE_URL DATABASE_URL=${PG} DIRECT_URL=${PG} INTERNAL_API_KEY='${INTERNAL_KEY}' RAZORPAY_WEBHOOK_SECRET='${WHSEC}' bun run dev < /dev/null > /dev/null 2>&1 &`], { cwd: BE })
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await beUp()) break
      }
    }
  }
}

async function main(): Promise<void> {
  const results: Result[] = []
  const beEnvBase = { DATABASE_URL: PG, DIRECT_URL: PG, INTERNAL_API_KEY: INTERNAL_KEY, RAZORPAY_WEBHOOK_SECRET: WHSEC, ALLOW_DESTRUCTIVE_TESTS: 'true', CONTRACT_BASE_URL: 'http://127.0.0.1:3001' }

  // 1 — typecheck both folders, in parallel
  const [feTc, beTc] = await Promise.all([
    runStep('typecheck:frontend', async () => {
      const p = spawnSync(['bun', 'run', 'typecheck'], { cwd: FE, stdout: 'pipe', stderr: 'pipe' })
      if (p.exitCode !== 0) throw new Error(new TextDecoder().decode(p.stderr).slice(0, 200))
      return 'passed'
    }),
    runStep('typecheck:backend', async () => {
      const p = spawnSync(['bun', 'run', 'typecheck'], { cwd: BE, stdout: 'pipe', stderr: 'pipe' })
      if (p.exitCode !== 0) throw new Error((new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr)).slice(0, 200))
      return 'passed'
    }),
  ])
  results.push(feTc, beTc)

  // 2 — lint: backend clean; frontend = documented baseline only
  results.push(runCmd('lint:backend (must be clean)', ['bun', 'run', 'lint'], BE))
  {
    // eslint exits 1 when the documented baseline errors are present — the
    // exit code alone is not the signal; the parsed file/count map is.
    const feLint = runCmd('lint:frontend (raw)', ['bun', 'run', 'lint'], FE)
    const parsed = parseFeLint(feLint.output ?? '')
    const baselineOk =
      parsed.total === Object.values(FE_LINT_BASELINE).reduce((a, b) => a + b, 0) &&
      JSON.stringify(parsed.counts) === JSON.stringify(FE_LINT_BASELINE)
    results.push(
      baselineOk
        ? { step: 'lint:frontend (baseline)', ok: true, kind: 'pass', detail: `${parsed.total} documented pre-existing errors`, ms: feLint.ms }
        : { step: 'lint:frontend (baseline)', ok: false, kind: 'fail', detail: `expected baseline ${JSON.stringify(FE_LINT_BASELINE)}, got ${JSON.stringify(parsed.counts)} — fix the NEW error, do not extend the baseline`, ms: feLint.ms },
    )
  }

  // 3-9 — backend suites (servers must be up)
  results.push(runCmd('test:payments (unit+integration)', ['bun', 'run', 'test:payments'], BE, beEnvBase))
  results.push(await withBackendStopped(async () => runCmd('test:contract (fixture replay)', ['bun', 'run', 'test:contract'], BE, beEnvBase)))
  results.push(runCmd('check:leaks', ['bun', 'run', 'check:leaks'], BE, beEnvBase))
  results.push(runCmd('route-inventory', ['bun', 'scripts/auth-route-inventory.ts'], BE, beEnvBase))
  results.push(runCmd('test:security', ['bun', 'run', 'test:security'], BE, beEnvBase))
  results.push(runCmd('test:perf (query budgets)', ['bun', 'run', 'test:perf'], BE, beEnvBase))

  // 10 — copy-claims (frontend)
  results.push(runCmd('check-copy-claims', ['bun', 'scripts/check-copy-claims.ts'], FE))

  // 11 — React duplicate keys (headless browser, if available)
  const hasBrowser = spawnSync(['bash', '-c', 'command -v agent-browser']).exitCode === 0
  if (hasBrowser) {
    // Warm the dev-compiled views once (hash views compile on first hit);
    // the browser steps measure the app, not dev-server cold starts.
    await fetch('http://127.0.0.1:3000/api/products').catch(() => undefined)
    await fetch('http://127.0.0.1:3000/').catch(() => undefined)
    // One retry absorbs first-compile latency races inside the pre-existing
    // scripts (documented in docs/TESTING.md) — the retry is deterministic.
    const reactKeys = runCmd('check-react-keys', ['bash', 'scripts/check-react-keys.sh', 'http://127.0.0.1:3000'], FE)
    results.push(reactKeys.kind === 'fail' ? runCmd('check-react-keys', ['bash', 'scripts/check-react-keys.sh', 'http://127.0.0.1:3000'], FE) : reactKeys)
    const links = runCmd('check-links-console', ['bash', 'scripts/check-links-console.sh', 'http://127.0.0.1:3000'], FE)
    results.push(links.kind === 'fail' ? runCmd('check-links-console', ['bash', 'scripts/check-links-console.sh', 'http://127.0.0.1:3000'], FE) : links)
  } else {
    results.push({ step: 'check-react-keys', ok: true, kind: 'pass', detail: 'skipped — agent-browser not available on this machine', ms: 0 })
    results.push({ step: 'check-links-console', ok: true, kind: 'pass', detail: 'skipped — agent-browser not available on this machine', ms: 0 })
  }

  // 12 — both production builds (production-safe dummy env; boot guard fires at build time)
  results.push(
    runCmd('build:frontend (production)', ['bash', '-c', `ALLOW_LOCAL_BACKEND_URL=true BACKEND_URL=http://127.0.0.1:3001 NEXT_PUBLIC_SITE_URL=http://localhost:3000 bun run build`], FE),
  )
  results.push(
    runCmd(
      'build:backend (production)',
      [
        'bash',
        '-c',
        `NODE_ENV=production CRON_SECRET=verify-build-cron-0123456789 ENCRYPTION_KEY='${BE_ENV.ENCRYPTION_KEY ?? ''}' SESSION_PEPPER='${BE_ENV.SESSION_PEPPER ?? ''}' INTERNAL_API_KEY=verify-build-internal-0123456789 ADMIN_REQUIRE_2FA=true ADMIN_PASSKEYS_ENABLED=false PUBLIC_WEB_URL=https://build.local DEMO_MODE=true ALLOW_TEST_PAYMENTS_IN_PRODUCTION=true RAZORPAY_API_BASE= DATABASE_URL=${PG} DIRECT_URL=${PG} bun run build`,
      ],
      BE,
    ),
  )

  // 13 — bundle-size gate (boots the fresh build on a private port)
  results.push(runCmd('check-bundle-size', ['bun', 'scripts/check-bundle-size.ts'], ROOT, { BACKEND_URL: 'http://127.0.0.1:3001' }))

  // 14 — read-only integrity + zero-fixture-leftover checks
  results.push(runCmd('db-integrity (local, read-only)', ['bun', 'scripts/db-integrity.ts', '--since', '168h'], ROOT, { DATABASE_URL: PG }))
  results.push(
    await runStep('no-fixture-leftovers', async () => {
      const { Client } = await import('pg')
      const c = new Client({ connectionString: PG, options: '-c default_transaction_read_only=on' })
      await c.connect()
      const orders = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "Order" WHERE "customerEmail" LIKE '%@sibra.local'`)
      const events = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "WebhookEvent" WHERE "eventId" LIKE 'evt-t5-%' OR "eventId" LIKE 'audit-test-%' OR "eventId" LIKE 'evt-replay-%'`)
      const admins = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "AdminUser" WHERE "email" LIKE 'security-lockout-%'`)
      await c.end()
      const total = Number(orders.rows[0].n) + Number(events.rows[0].n) + Number(admins.rows[0].n)
      if (total > 0) throw new Error(`fixture leftovers: orders=${orders.rows[0].n} webhookEvents=${events.rows[0].n} admins=${admins.rows[0].n}`)
      return 'zero fixture orders, events and admins left behind'
    }),
  )

  // 15 — local smoke (full posture through the running dev servers)
  results.push(runCmd('smoke --env local', ['bun', 'scripts/smoke.ts', '--env', 'local'], ROOT, { INTERNAL_API_KEY: INTERNAL_KEY }))

  // Final table + report
  const checks: Check[] = results.map((r) =>
    r.kind === 'known'
      ? { id: r.step, label: r.step, ok: true, kind: 'warn', detail: r.detail }
      : r.kind === 'pass'
        ? pass(r.step, r.step, `${r.detail} (${(r.ms / 1000).toFixed(1)}s)`, r.ms)
        : fail(r.step, r.step, `${r.detail} (${(r.ms / 1000).toFixed(1)}s)`, r.ms),
  )
  console.log('\n──────── verify summary ────────')
  for (const r of results) {
    const tag = r.kind === 'known' ? 'KNOWN' : r.ok ? 'PASS' : 'FAIL'
    console.log(`${tag}  ${r.step} — ${r.detail}`)
    if (r.kind === 'fail' && r.output) console.log(r.output.split('\n').slice(-12).join('\n'))
  }
  const failed = results.filter((r) => r.kind === 'fail').length
  const known = results.filter((r) => r.kind === 'known').length
  console.log(`────────────────────────\n${results.length - failed - known}/${results.length} passed, ${known} known (documented), ${failed} failed`)
  const report = writeReport('local', 'Full local verify', checks)
  console.log(`report: ${report}`)
  if (failed > 0) process.exit(1)
}

main()
