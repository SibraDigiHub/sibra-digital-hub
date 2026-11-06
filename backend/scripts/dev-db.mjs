#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Local PostgreSQL launcher (development only).
//
//   node scripts/dev-db.mjs start   → boot Postgres on 127.0.0.1:5433
//                                     (data dir: backend/.pgdata, db: sdh_dev)
//   node scripts/dev-db.mjs stop    → stop the cluster (SIGINT postmaster)
//
// Uses the `embedded-postgres` devDependency (no Docker / no root
// required). Prints the DATABASE_URL to use in backend/.env.
// ═══════════════════════════════════════════════════════════
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../.pgdata')
const PORT = 5433
const USER = 'sdh'
const PASSWORD = 'sdh'
const DB = 'sdh_dev'
const URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}`

const command = process.argv[2] ?? 'start'

if (command === 'stop') {
  const pidFile = path.join(DATA_DIR, 'postmaster.pid')
  if (!existsSync(pidFile)) {
    console.log('dev-db: not running (no postmaster.pid)')
    process.exit(0)
  }
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').split('\n')[0], 10)
  if (!Number.isFinite(pid)) {
    console.error('dev-db: could not parse postmaster.pid')
    process.exit(1)
  }
  process.kill(pid, 'SIGINT')
  console.log(`dev-db: sent SIGINT to postgres (pid ${pid})`)
  process.exit(0)
}

if (command !== 'start') {
  console.error('usage: node scripts/dev-db.mjs [start|stop]')
  process.exit(1)
}

const initialised = existsSync(path.join(DATA_DIR, 'PG_VERSION'))

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
})

try {
  if (!initialised) {
    console.log('dev-db: initialising cluster (first run, ~10s)…')
    await pg.initialise()
  }
  console.log(`dev-db: starting postgres on 127.0.0.1:${PORT}…`)
  await pg.start()
  try {
    await pg.createDatabase(DB)
    console.log(`dev-db: created database "${DB}"`)
  } catch {
    // already exists — fine
  }
  console.log('──────────────────────────────────────────────')
  console.log('dev-db: PostgreSQL is READY (keep this terminal open)')
  console.log(`DATABASE_URL=${URL}?connection_limit=1`)
  console.log(`DIRECT_URL=${URL}`)
  console.log('Paste both into backend/.env, then: npm run migrate:reset && npm run db:seed')
  console.log('──────────────────────────────────────────────')
  // Keep the process alive — the child postgres dies when this script exits.
  const stayAlive = setInterval(() => {}, 60_000)
  const shutdown = async () => {
    clearInterval(stayAlive)
    try {
      await pg.stop()
    } catch {
      // already gone
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (err) {
  console.error('dev-db failed:', err)
  process.exit(1)
}
