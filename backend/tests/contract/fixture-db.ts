// ═══════════════════════════════════════════════════════════
// Contract-fixture DB reset — creates a CLEAN, disposable local
// Postgres database for the deterministic contract fixture.
//
//   DATABASE_URL=postgresql://…/sibra_contract bun tests/contract/fixture-db.ts reset
//
// Connects to the server's maintenance DB ("postgres") and runs
// DROP DATABASE IF EXISTS … WITH (FORCE) + CREATE DATABASE, so
// every capture/replay starts from byte-zero state. Refuses to
// touch anything that is not the dedicated *_contract database.
// ═══════════════════════════════════════════════════════════
import { Client } from 'pg'

const mode = process.argv[2] ?? 'reset'
const url = process.env.DATABASE_URL ?? ''
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '')
  } catch {
    return ''
  }
})()

if (!url.startsWith('postgresql') || !dbName) {
  console.error('fixture-db: DATABASE_URL must be a postgresql:// URL (got nothing usable)')
  process.exit(1)
}
const allowedHost = process.env.CONTRACT_FIXTURE_ALLOWED_HOST ?? ''
const actualHost = new URL(url).hostname

// Hard stop: only the exact dedicated contract database on the
// verified sibra-testing Neon endpoint may ever be reset.
if (dbName !== 'sibra_contract') {
  console.error('fixture-db: refusing to reset anything except sibra_contract')
  process.exit(1)
}

if (
  allowedHost !== 'ep-silent-waterfall-aowa1s8o.c-2.ap-southeast-1.aws.neon.tech' ||
  actualHost !== allowedHost
) {
  console.error('fixture-db: refusing database reset — Neon TEST host verification failed')
  process.exit(1)
}

// Connect to the maintenance DB ("postgres") — strip the target DB from
// the URL first (pg prefers the URL path over an explicit database option).
const adminUrl = new URL(url)
adminUrl.pathname = '/postgres'
const admin = new Client({ connectionString: adminUrl.toString() })
await admin.connect()

if (mode === 'reset') {
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  await admin.query(`CREATE DATABASE "${dbName}"`)
  console.log(`fixture-db: database "${dbName}" recreated (clean)`)
} else {
  console.error(`fixture-db: unknown mode "${mode}"`)
  await admin.end()
  process.exit(1)
}

await admin.end()
