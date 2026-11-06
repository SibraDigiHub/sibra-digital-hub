// ═══════════════════════════════════════════════════════════
// perf-api.ts — API latency vs budgets (perf-budgets.json → api).
//
//   bun scripts/perf-api.ts [N]          (default 30 runs/endpoint)
//   PERF_BASE_URL=http://… bun scripts/perf-api.ts
//
// Reuses the method (and endpoints) of backend/scripts/perf-baseline.ts
// and FAILS with a non-zero exit code when an endpoint's p95 exceeds
// its budget. `--ci` doubles the budgets for shared-CI runners.
// ═══════════════════════════════════════════════════════════

import { percentile } from './_lib'

const budgets: { api: Record<string, { path: string; p95Ms: number }> } = require('../perf-budgets.json')

const BASE = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3001'
const argv = process.argv.slice(2)
const runs = Math.max(5, Number(argv.find((a) => /^\d+$/.test(a)) ?? 30))
const ciMultiplier = argv.includes('--ci') ? 2 : 1

async function measure(path: string): Promise<number[]> {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = Date.now()
    const res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': 'perf-api/1.0' } })
    await res.text()
    samples.push(Date.now() - started)
  }
  return samples
}

async function main(): Promise<void> {
  console.log(`perf-api: ${runs} runs/endpoint against ${BASE}${ciMultiplier > 1 ? ' (CI budgets ×2)' : ''}`)
  const rows: Array<{ name: string; p50: number; p95: number; budget: number; ok: boolean }> = []
  let failures = 0
  for (const [name, { path, p95Ms }] of Object.entries(budgets.api)) {
    const samples = await measure(path)
    const p50 = percentile(samples, 50)
    const p95 = percentile(samples, 95)
    const budget = p95Ms * ciMultiplier
    const ok = p95 <= budget
    if (!ok) failures += 1
    rows.push({ name, p50, p95, budget, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} p50=${String(p50).padStart(5)}ms  p95=${String(p95).padStart(5)}ms  budget=${budget}ms`)
  }
  console.log(`\nperf-api: ${rows.length - failures}/${rows.length} endpoints within budget (baseline: docs/PERF_BASELINE.md)`)
  if (failures > 0) process.exit(1)
}

main().catch((e: Error) => {
  console.error(`perf-api failed: ${e.message}`)
  process.exit(1)
})
