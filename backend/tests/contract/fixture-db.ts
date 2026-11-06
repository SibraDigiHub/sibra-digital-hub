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
if (!dbName.endsWith('_contract')) {
  // Hard stop: this tool only ever resets a dedicated *_contract DB —
  // never the dev database ("sibra") or anything production-like.
  console.error(`fixture-db: refusing to operate on "${dbName}" — the fixture DB name must end with "_contract"`)
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
