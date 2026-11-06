#!/usr/bin/env bash
# Local development PostgreSQL — the only supported local database engine.
#
# Starts PostgreSQL 17 if it is not already running, ensures the `sibra`
# database exists, applies migrations, and prints the local DATABASE_URL.
#
# Usage:  bun run dev-db        (from backend/)
#         bash scripts/dev-db.sh
#
# On your own machine you can also use Docker instead:
#   docker run -d --name sdh-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/sibra"
set -euo pipefail

# SANDBOX-ONLY defaults from the ephemeral cloud workspace — on your own
# machine set SDH_PG_BIN/SDH_PGDATA (or use system/Docker Postgres,
# docs/LOCAL_SETUP.md).
PG_BIN="${SDH_PG_BIN:-/home/z/pg17/bin}"
PGDATA="${SDH_PGDATA:-/home/z/pgdata}"
HOST=127.0.0.1
PORT=5432
SUPERUSER=postgres
DB_NAME=sibra
URL="postgresql://${SUPERUSER}@${HOST}:${PORT}/${DB_NAME}"

if command -v pg_isready >/dev/null 2>&1; then PGISREADY=$(command -v pg_isready); else PGISREADY="$PG_BIN/pg_isready"; fi

if ! "$PGISREADY" -h "$HOST" -p "$PORT" >/dev/null 2>&1; then
  if [ ! -d "$PGDATA" ]; then
    echo "▸ initdb → $PGDATA"
    "$PG_BIN/initdb" -D "$PGDATA" -U "$SUPERUSER" -A trust -E UTF8 >/dev/null
  fi
  echo "▸ starting PostgreSQL 17 on $HOST:$PORT"
  ( setsid nohup "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
      -o "-p $PORT -c listen_addresses=$HOST" start >/dev/null 2>&1 < /dev/null & )
  for _ in $(seq 1 20); do
    "$PGISREADY" -h "$HOST" -p "$PORT" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

"$PGISREADY" -h "$HOST" -p "$PORT" >/dev/null 2>&1 || { echo "❌ PostgreSQL did not start — see $PGDATA/server.log"; exit 1; }

if [ -f "$PG_BIN/psql" ]; then
  "$PG_BIN/psql" -h "$HOST" -p "$PORT" -U "$SUPERUSER" -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    "$PG_BIN/psql" -h "$HOST" -p "$PORT" -U "$SUPERUSER" -c "CREATE DATABASE $DB_NAME" >/dev/null
else
  bun -e "import {Client} from 'pg'; const c=new Client({host:'$HOST',port:$PORT,user:'$SUPERUSER'}); await c.connect(); const e=await c.query(\"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"); if(!e.rowCount) await c.query('CREATE DATABASE $DB_NAME'); await c.end();" 2>/dev/null || true
fi

cd "$(dirname "$0")/.."
DATABASE_URL="$URL" DIRECT_URL="$URL" bunx prisma migrate deploy
echo "✅ Local PostgreSQL ready:  DATABASE_URL=$URL"
