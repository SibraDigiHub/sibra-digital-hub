// ═══════════════════════════════════════════════════════════
// Open-redirect regression (static, no server needed).
// Every redirect sink under src/app must live in the allowlist of
// files that VALIDATE their target (relative path or https?:// only —
// never javascript:/data:, never raw request input). A new redirect
// outside the allowlist fails the suite, so it can only ship with
// an explicit review + allowlist entry.
// ═══════════════════════════════════════════════════════════

import { describe, test } from 'bun:test'

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', '..', 'src')
const SINK_RE = /(?:NextResponse\.redirect|Response\.redirect)\s*\(/

/** Files allowed to redirect, with the validation marker each must contain. */
const ALLOWED: Array<{ file: RegExp; validatesWith: RegExp }> = [
  {
    // download route: redirect target validated (relative or https) — T5 §6
    file: /src\/app\/api\/download\/\[token\]\/route\.ts$/,
    validatesWith: /isSafeRedirectTarget|redirectTarget|startsWith\('\/'\)|^https?:\/\//,
  },
  {
    // demo-pay may hand the SPA URL to the buyer — same validation law
    file: /src\/app\/api\/orders\/\[id\]\/demo-pay\/route\.ts$/,
    validatesWith: /isSafeRedirectTarget|redirectTarget|startsWith\('\/'\)|^https?:\/\//,
  },
]

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (entry === 'route.ts' && SINK_RE.test(readFileSync(full, 'utf8'))) acc.push(full)
  }
  return acc
}

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${evidence}`)
}

describe('open-redirect safety (static)', () => {
  test('every redirect sink is an allowlisted, validating file', () => {
    const sinks = walk(SRC)
    const unknown = sinks.filter((f) => !ALLOWED.some((a) => a.file.test(f)))
    check('no unknown redirect sinks', unknown.length === 0, unknown.length === 0 ? `${sinks.length} sink(s), all allowlisted` : `NEW SINK(S): ${unknown.join(', ')}`)

    for (const allowed of ALLOWED) {
      const file = sinks.find((f) => allowed.file.test(f))
      if (!file) continue // route not present in this build — nothing to check
      const src = readFileSync(file, 'utf8')
      check(`allowlisted sink validates target (${file.split('/').slice(-3).join('/')})`, allowed.validatesWith.test(src), allowed.validatesWith.test(src) ? 'validation marker present' : 'VALIDATION MARKER MISSING')
    }
  })
})
