#!/usr/bin/env bun
// Perf baseline: p50/p95 latency for top public endpoints.
// Usage: bun scripts/perf-baseline.ts [requests=60] > docs/PERF_BASELINE.md (append)
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3001'
const N = Number(process.argv[2] ?? 60)

const EPS: [string, string][] = [
  ['products-list', '/api/products'],
  ['products-zone-kids', '/api/products?zone=kids'],
  ['product-search', '/api/products?search=coloring'],
  ['faqs', '/api/faqs'],
  ['reviews', '/api/reviews'],
  ['settings', '/api/settings'],
]

async function bench(path: string) {
  const xs: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    const r = await fetch(`${BASE}${path}`)
    await r.text()
    xs.push(performance.now() - t0)
  }
  xs.sort((a, b) => a - b)
  const p = (q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))].toFixed(1)
  return { p50: p(0.5), p95: p(0.95) }
}

const rows: string[] = []
for (const [name, path] of EPS) {
  const r = await bench(path)
  rows.push(`| ${name} | ${path} | ${r.p50} | ${r.p95} |`)
  console.error(`${name}: p50=${r.p50}ms p95=${r.p95}ms`)
}
console.log(`| endpoint | path | p50 (ms) | p95 (ms) |
|---|---|---|---|
${rows.join('\n')}`)

export {}
