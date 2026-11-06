// ═══════════════════════════════════════════════════════════
// Frontend destructive-test guard — same law as backend/tests/_guard.ts.
//
// The frontend currently ships NO destructive scripts (check-react-keys,
// check-copy-claims and check-bundle-size are all read-only), so nothing
// imports this file yet. Any future destructive frontend test/script
// MUST import it first:
//
//   import { assertDestructiveAllowed } from '../tests/_guard'
//   assertDestructiveAllowed('my-destructive-script')
//
// It refuses (exit 1) unless the target database is local or named
// test/staging AND ALLOW_DESTRUCTIVE_TESTS=true is set explicitly.
// ═══════════════════════════════════════════════════════════

interface DbTarget {
  host: string
  database: string
}

export function parseDbUrl(url: string | undefined): DbTarget | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return null
    return { host: parsed.hostname, database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) }
  } catch {
    return null
  }
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
}

function looksLikeTestDb(database: string): boolean {
  return /(^|_)(test|staging)(_|\b|$)/i.test(database) || /_contract$/.test(database)
}

export function assertDestructiveAllowed(label = 'this script'): DbTarget {
  const target = parseDbUrl(process.env.DATABASE_URL)
  if (!target) {
    console.error(`DESTRUCTIVE-TEST REFUSAL (${label}): DATABASE_URL is missing or not a postgres:// URL — refusing to run.`)
    process.exit(1)
  }
  if (process.env.ALLOW_DESTRUCTIVE_TESTS !== 'true') {
    console.error(
      `DESTRUCTIVE-TEST REFUSAL (${label}): ALLOW_DESTRUCTIVE_TESTS=true must be set explicitly.\n` +
        `  database: ${target.database} @ ${target.host}`,
    )
    process.exit(1)
  }
  if (!(isLocalHost(target.host) || looksLikeTestDb(target.database))) {
    console.error(
      `DESTRUCTIVE-TEST REFUSAL (${label}): the database does not look disposable.\n` +
        `  database: ${target.database} @ ${target.host}\n` +
        `  This refusal protects production data — if you are pointing at production, STOP.`,
    )
    process.exit(1)
  }
  return target
}
