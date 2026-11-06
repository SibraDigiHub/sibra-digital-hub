// ═══════════════════════════════════════════════════════════
// check-bundle-size.ts — frontend bundle budget gate (§2.6).
//
//   bun scripts/check-bundle-size.ts
//
// Requires a PRODUCTION build in frontend/.next (npm run build first —
// `npm run verify` does it). The script boots `next start` on a private
// port, fetches every budgeted route's HTML, collects the initial
// script/preload chunks, sums their on-disk bytes (= First Load JS)
// and fails when a route exceeds its budget in perf-budgets.json.
//
// It also asserts the 3D/transition rule from the task: the three.js
// chunk must NEVER be part of ANY route's initial payload (it stays
// behind the idle-time dynamic import), and the gsap/transition chunk
// must not be initial on NON-gateway routes. (Measured baseline: the
// gateway `/` currently ships the 70 KB gsap chunk initial — recorded
// in docs/FINDINGS.md; the budget pins it so it cannot grow silently.)
// ═══════════════════════════════════════════════════════════

import { spawn, spawnSync } from 'bun'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const FE = join(ROOT, 'frontend')
const PORT = 3311
const BASE = `http://127.0.0.1:${PORT}`
const budgets: { bundle: Record<string, { firstLoadJsKb: number; marginKb: number }> } = require(join(ROOT, 'perf-budgets.json'))

const ROUTES = Object.keys(budgets.bundle).filter((k) => !k.startsWith('$'))

function chunkBytes(name: string): number {
  const file = join(FE, '.next', name)
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** Find the chunks containing three.js / GSAP by content marker. */
function heavyChunks(marker: RegExp): Set<string> {
  const dir = join(FE, '.next/static/chunks')
  const found = new Set<string>()
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js')) continue
      const bytes = readFileSync(join(dir, f))
      if (marker.test(bytes.toString('latin1'))) found.add(`static/chunks/${f}`)
    }
  } catch {
    /* no chunks dir */
  }
  return found
}

async function waitForHealth(deadlineMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`)
      if (res.status < 500) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function main(): Promise<void> {
  let failures = 0
  const rows: string[] = []

  // Locate the heavy chunks BEFORE measuring (they must exist — sanity).
  const threeChunks = heavyChunks(/WebGLRenderer|react-three-fiber|THREE\.REVISION/)
  const gsapChunks = heavyChunks(/gsap/)
  if (threeChunks.size === 0) {
    console.error('check-bundle-size: could not locate the three.js chunk — was the production build run?')
    process.exit(1)
  }
  rows.push(`info  three.js chunk(s): ${[...threeChunks].join(', ')} — must never be initial`)
  rows.push(`info  gsap chunk(s): ${[...gsapChunks].join(', ') || '(inlined/tree-shaken)'}`)

  // `next start` shares .next with a running `next dev` — running both in
  // the same directory hangs the dev server. Stop it, measure, restore.
  const devWasUp = await fetch('http://127.0.0.1:3000/').then((r) => r.status < 500).catch(() => false)
  if (devWasUp) {
    spawnSync(['pkill', '-f', 'next dev -p 3000'])
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const up = await fetch('http://127.0.0.1:3000/').then(() => true).catch(() => false)
      if (!up) break
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // Boot the production frontend on a private port.
  const server = spawn(['./node_modules/.bin/next', 'start', '-p', String(PORT)], {
    cwd: FE,
    env: { ...process.env, NODE_ENV: 'production', BACKEND_URL: process.env.BACKEND_URL ?? 'http://127.0.0.1:3001', ALLOW_LOCAL_BACKEND_URL: 'true' },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  try {
    if (!(await waitForHealth())) {
      console.error('check-bundle-size: production frontend did not become healthy on the private port')
      process.exit(1)
    }

    for (const route of ROUTES) {
      const res = await fetch(`${BASE}${route === '/' ? '/' : route}`)
      const html = await res.text()
      const srcs = [...html.matchAll(/(?:<script[^>]+src=|<link[^>]+rel="preload"[^>]+as="script"[^>]+href=)"(\/_next\/[^"]+\.js)"/g)].map((m) => m[1].replace('/_next/', ''))
      const unique = [...new Set(srcs)]
      const totalKb = Math.round(unique.reduce((sum, name) => sum + chunkBytes(name), 0) / 1024)
      const budget = budgets.bundle[route]
      const limit = budget.firstLoadJsKb + budget.marginKb
      const ok = totalKb <= limit
      if (!ok) failures += 1
      rows.push(`${ok ? 'PASS' : 'FAIL'}  ${route.padEnd(16)} First Load JS ≈ ${totalKb} KB (budget ${budget.firstLoadJsKb} KB + margin ${budget.marginKb} KB, ${unique.length} initial chunks)`)
      // three.js must never be initial anywhere; gsap only tolerated on
      // the gateway route (known baseline — see docs/FINDINGS.md).
      const isGateway = route === '/'
      const heavyInitial = unique.filter((n) => threeChunks.has(n) || (!isGateway && gsapChunks.has(n)))
      if (heavyInitial.length > 0) {
        failures += 1
        rows.push(`FAIL  ${route.padEnd(16)} heavy chunk in initial payload: ${heavyInitial.join(', ')}`)
      }
    }
  } finally {
    server.kill()
    // Belt and braces: the spawned `next` child tree must not linger.
    spawnSync(['bash', '-c', `pkill -f "next start -p ${PORT}" 2>/dev/null || true`])
    if (devWasUp) {
      // Restore the dev server exactly as it was (setsid — detached from
      // this process group, same restart pattern as verify.ts). The proxy
      // key is pinned from frontend/.env because the runtime ignores the
      // file value in this sandbox (see docs/FINDINGS.md #env-drift-401).
      const feEnv: Record<string, string> = {}
      try {
        for (const line of readFileSync(join(FE, '.env'), 'utf8').split('\n')) {
          const m = /^([A-Z_0-9]+)=(.*)$/.exec(line)
          if (m) feEnv[m[1]] = m[2].replace(/^"|"$/g, '')
        }
      } catch {
        /* no .env — dev defaults apply */
      }
      const pin = [
        `INTERNAL_API_KEY='${feEnv.INTERNAL_API_KEY ?? ''}'`,
        `BACKEND_URL='${feEnv.BACKEND_URL ?? 'http://127.0.0.1:3001'}'`,
        `NEXT_PUBLIC_SITE_URL='${feEnv.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}'`,
      ].join(' ')
      spawnSync(['setsid', 'bash', '-c', `cd ${FE} && env ${pin} bun run dev < /dev/null > /dev/null 2>&1 &`])
      const deadline = Date.now() + 40_000
      while (Date.now() < deadline) {
        const up = await fetch('http://127.0.0.1:3000/').then((r) => r.status < 500).catch(() => false)
        if (up) break
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  console.log('check-bundle-size (production build, served HTML):')
  for (const r of rows) console.log(`  ${r}`)
  console.log(`\ncheck-bundle-size: ${failures === 0 ? 'PASS — all routes within budget, 3D stays lazy' : `FAIL — ${failures} budget violation(s)`}`)
  if (failures > 0) process.exit(1)
}

main()
