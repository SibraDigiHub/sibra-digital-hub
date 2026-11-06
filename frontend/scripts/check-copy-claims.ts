// ═══════════════════════════════════════════════════════════
// check-copy-claims.ts — copy-accuracy gate (runs in verify:fast).
//
// Scans user-facing copy (UI components, legal text, FAQ/seed text,
// llms.txt, e-mail templates, JSON-LD) for forbidden or inconsistent
// claims and prints file:line for every violation. Exit code 1 when
// a non-known violation is found.
//
// Forbidden / inconsistent:
//   • "never expires", "no expiry", "unlimited downloads",
//     "lifetime access" — the real contract is 48 h / 5 downloads
//   • download-window numbers that disagree with the backend defaults
//     (DOWNLOAD_TTL_HOURS / DOWNLOAD_MAX_DEFAULT, parsed from env.ts)
//   • "guaranteed", "worldwide" marketing language
//   • Payhip/Gumroad described as OUR payment gateway (they are
//     external marketplaces; Razorpay/PayPal are the gateways)
//   • Razorpay described as international/worldwide (India-only)
//   • demo/seed testimonials presented as "verified"
//
// KNOWN ISSUES are pre-existing, documented copy bugs (docs/LEGAL_PAGES.md
// and docs/FINDINGS.md). They are printed as KNOWN on every run and do
// NOT fail the gate — anything NEW fails. Fix the copy, then remove the
// entry from KNOWN_ISSUES below.
// ═══════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

interface Violation {
  file: string
  line: number
  rule: string
  text: string
  known: boolean
}

/** Pre-existing, documented copy bugs — printed as KNOWN, not failing.
 *  Currently EMPTY: the last entry (ThankYouView "72h" vs 48 h default) was
 *  fixed in the UI and removed from this whitelist — the download-window
 *  rule now fails the gate for it like any new violation. */
const KNOWN_ISSUES: Array<{ file: RegExp; rule: string; reason: string }> = []

interface Rule {
  id: string
  pattern: RegExp
  applies: (file: string) => boolean
  explain: string
}

const ALL_FILES = () => true
const SEED_ONLY = (file: string) => file.includes('backend/src/lib/seed-data.ts')

const RULES: Rule[] = [
  { id: 'never-expires', pattern: /never\s+expire|no\s+expiry|unlimited\s+downloads|lifetime\s+access/i, applies: ALL_FILES, explain: 'download links expire (48 h / 5 downloads by default) — this promise is false' },
  { id: 'guaranteed', pattern: /\bguaranteed\b/i, applies: ALL_FILES, explain: 'unqualified guarantee — remove or qualify legally' },
  { id: 'worldwide', pattern: /world\s*-?\s*wide/i, applies: ALL_FILES, explain: 'payment coverage is Razorpay (India) + PayPal (international), not "worldwide"' },
  { id: 'download-window-number', pattern: /(?:valid|link|download)[^\n]{0,60}?(?:\b(\d+)\s*(?:hours|hrs)\b|\b(\d+)h\b)|(?:\b(\d+)\s*(?:hours|hrs)\b|\b(\d+)h\b)[^\n]{0,60}?(?:valid|link|download)/i, applies: ALL_FILES, explain: 'download-window number must equal DOWNLOAD_TTL_HOURS' },
  { id: 'download-count-number', pattern: /\b(\d+)\s+(?:full\s+)?downloads\b/i, applies: ALL_FILES, explain: 'download count must equal DOWNLOAD_MAX_DEFAULT' },
  { id: 'marketplace-as-gateway', pattern: /(?:payhip|gumroad)[^\n]{0,80}(?:gateway|payment method|pay (?:by|via|with) )|(?:gateway|payment method|pay (?:by|via|with) )[^\n]{0,80}(?:payhip|gumroad)/i, applies: ALL_FILES, explain: 'Payhip/Gumroad are external marketplaces, not this site\'s payment gateways' },
  // Razorpay described AS international — but the correct split copy
  // ("Razorpay (India) … PayPal (international)") co-attributes India on
  // the same line; that line-level exclusion happens in the scan loop.
  { id: 'razorpay-international', pattern: /razorpay[^\n]{0,80}(?:worldwide|global|international)|(?:worldwide|global|international)[^\n]{0,80}razorpay/i, applies: ALL_FILES, explain: 'Razorpay is the India gateway; international payments go through PayPal' },
  { id: 'seed-verified-testimonial', pattern: /verified\s*:\s*true/i, applies: SEED_ONLY, explain: 'demo/seed review data must not be presented as verified purchases (verified:false is the correct seeded posture)' },
]

/** Files scanned: frontend copy surfaces + backend seed/e-mail templates. */
function scanTargets(): string[] {
  const targets: string[] = []
  const pushIfFile = (p: string): void => {
    try {
      statSync(p)
      targets.push(p)
    } catch {
      /* optional surface not present */
    }
  }
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, acc)
      else if (/\.(ts|tsx)$/.test(entry)) acc.push(full)
    }
    return acc
  }
  targets.push(...walk(join(ROOT, 'frontend/src/components')).filter((f) => !f.includes(`${join('components', 'admin')}`)))
  targets.push(...walk(join(ROOT, 'frontend/src/lib')))
  targets.push(...walk(join(ROOT, 'frontend/src/app')))
  pushIfFile(join(ROOT, 'backend/src/lib/seed-data.ts'))
  pushIfFile(join(ROOT, 'backend/src/lib/email.ts'))
  return targets
}

/** Parse the backend defaults out of src/config/env.ts (zod .default(n)). */
function backendDefaults(): { ttlHours: number; maxDownloads: number } {
  let ttlHours = 48
  let maxDownloads = 5
  try {
    const env = readFileSync(join(ROOT, 'backend/src/config/env.ts'), 'utf8')
    ttlHours = Number(/DOWNLOAD_TTL_HOURS:[^\n]*?\.default\((\d+)\)/.exec(env)?.[1] ?? 48)
    maxDownloads = Number(/DOWNLOAD_MAX_DEFAULT:[^\n]*?\.default\((\d+)\)/.exec(env)?.[1] ?? 5)
  } catch {
    /* keep the documented defaults */
  }
  return { ttlHours, maxDownloads }
}

function isKnown(file: string, rule: string): string | null {
  for (const k of KNOWN_ISSUES) {
    if (k.file.test(file) && k.rule === rule) return k.reason
  }
  return null
}

function main(): void {
  const { ttlHours, maxDownloads } = backendDefaults()
  const violations: Violation[] = []
  const knownHits: Array<Violation & { reason: string }> = []

  for (const file of scanTargets()) {
    const rel = relative(ROOT, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      const line = i + 1
      // skip import lines and comments/whitespace-only noise
      if (/^\s*(import|export\s+type|\/\/|\*|\/\*)/.test(text)) return
      for (const rule of RULES) {
        if (!rule.applies(rel)) continue
        const m = rule.pattern.exec(text)
        if (!m) continue
        if (rule.id === 'download-window-number') {
          const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4])
          if (n === ttlHours) continue
        }
        if (rule.id === 'download-count-number') {
          if (Number(m[1]) === maxDownloads) continue
        }
        // A line is a violation only when it claims international/worldwide
        // reach FOR Razorpay without the correct split construction. Correct
        // split copy ("Razorpay (India) … PayPal (international)" /
        // "…via Razorpay; international: PayPal") always co-mentions either
        // India or PayPal on the same line — those lines are skipped.
        if (rule.id === 'razorpay-international' && (/india/i.test(text) || /paypal/i.test(text))) continue
        const v: Violation = { file: rel, line, rule: rule.id, text: text.trim().slice(0, 120), known: false }
        const known = isKnown(rel, rule.id)
        if (known) {
          v.known = true
          knownHits.push({ ...v, reason: known })
        } else {
          violations.push(v)
        }
      }
    })
  }

  if (knownHits.length > 0) {
    console.log(`KNOWN copy issues (documented, not failing — see docs/FINDINGS.md):`)
    for (const k of knownHits) console.log(`  KNOWN  ${k.file}:${k.line} [${k.rule}] ${k.text}`)
  }
  if (violations.length > 0) {
    console.error(`\nCOPY CLAIMS: ${violations.length} violation(s):`)
    for (const v of violations) console.error(`  FAIL  ${v.file}:${v.line} [${v.rule}] ${v.text}`)
    process.exit(1)
  }
  console.log(`COPY CLAIMS: PASS — no forbidden or inconsistent claims (TTL=${ttlHours} h, max=${maxDownloads} downloads; scanned frontend/src components+lib+app, backend seed-data.ts + email.ts)`)
}

main()
