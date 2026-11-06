// ═══════════════════════════════════════════════════════════
// Destructive-test guard — imported by EVERY test/script that
// creates, mutates or deletes data (fixtures, cleanup, resets).
//
// A destructive suite may only run when ALL of these hold:
//   1. the database host is local (localhost/127.0.0.1) OR the
//      database name contains `test`/`staging` (CI/Neon branches);
//   2. ALLOW_DESTRUCTIVE_TESTS=true is set explicitly.
// Anything that looks like production (remote host + prod-shaped
// db name) is refused with a clear message and a non-zero exit —
// so a stale shell env can never wipe real customer data.
//
// Usage: import '../_guard' (side-effect) at the top of the file,
// or call assertDestructiveAllowed(label) for scripts that want a
// labelled check. Runs from `bun test` abort the whole run.
// ═══════════════════════════════════════════════════════════

interface DbTarget {
  host: string
  database: string
}

/** Parse the bare essentials out of a postgres:// URL without logging it. */
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

/**
 * Decide, and throw/refuse, whether destructive work may proceed.
 * Returns the parsed target so callers can print context safely.
 */
export function assertDestructiveAllowed(label = 'this suite'): DbTarget {
  const url = process.env.DATABASE_URL
  const target = parseDbUrl(url)
  if (!target) {
    const msg = `DESTRUCTIVE-TEST REFUSAL (${label}): DATABASE_URL is missing or not a postgres:// URL — refusing to run.`
    console.error(msg)
    process.exit(1)
  }
  const envAllowed = process.env.ALLOW_DESTRUCTIVE_TESTS === 'true'
  const dbShapeSafe = isLocalHost(target.host) || looksLikeTestDb(target.database)
  if (!envAllowed) {
    console.error(
      `DESTRUCTIVE-TEST REFUSAL (${label}): ALLOW_DESTRUCTIVE_TESTS=true must be set explicitly.\n` +
        `  database: ${target.database} @ ${target.host}\n` +
        `  If this is genuinely a disposable database, re-run with ALLOW_DESTRUCTIVE_TESTS=true.`,
    )
    process.exit(1)
  }
  if (!dbShapeSafe) {
    console.error(
      `DESTRUCTIVE-TEST REFUSAL (${label}): the database does not look disposable.\n` +
        `  database: ${target.database} @ ${target.host}\n` +
        `  Allowed: a local host (localhost/127.0.0.1) OR a db name containing test/staging (or ending _contract).\n` +
        `  This refusal protects production data — if you are pointing at production, STOP.`,
    )
    process.exit(1)
  }
  return target
}
