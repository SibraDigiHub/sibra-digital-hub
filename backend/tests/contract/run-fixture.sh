#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# Deterministic contract-test harness (dev-data independence).
#
#   bash tests/contract/run-fixture.sh capture   → goldens from fixture
#   bash tests/contract/run-fixture.sh replay    → compare vs goldens
#
# Pipeline (all against a DISPOSABLE local database):
#   1. recreate clean DB  sibra_contract        (fixture-db.ts)
#   2. prisma migrate deploy                    (real migrations)
#   3. prisma/seed.ts                           (known catalog data)
#   4. fixture-data.ts                          (pin coords, admin, 1 order)
#   5. boot the backend on :3007 (dev mode)     (log: .fixture-server.log)
#   6. run tests/contract/runner.ts against it  (CONTRACT_BASE_URL)
#   7. kill the server (trap)
#
# The admin password is GENERATED per run and only passed via env —
# nothing credential-like is ever written to the repo. The dev DB
# ("sibra") and any non *_contract database are never touched.
# ═══════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.." # backend/

MODE="${1:-replay}"
case "$MODE" in capture | replay) ;; *) echo "usage: run-fixture.sh capture|replay"; exit 1;; esac

PORT="${CONTRACT_FIXTURE_PORT:-3007}"
FIXTURE_DB="${CONTRACT_FIXTURE_DB:-sibra_contract}"

# Strict allowlist: ONLY the verified sibra-testing Neon project.
EXPECTED_TEST_DIRECT_HOST="ep-silent-waterfall-aowa1s8o.c-2.ap-southeast-1.aws.neon.tech"
EXPECTED_TEST_POOL_HOST="ep-silent-waterfall-aowa1s8o-pooler.c-2.ap-southeast-1.aws.neon.tech"

if [[ "$FIXTURE_DB" != "sibra_contract" ]]; then
  echo "run-fixture: refusing database other than sibra_contract"
  exit 1
fi

# Ignore inherited shell overrides. Bun will load the verified values
# from backend/.env instead of accidentally using an old local DB URL.
unset DATABASE_URL DIRECT_URL

# Read existing Neon TEST connection strings without displaying credentials.
DB_URLS="$(bun -e '
const pool = new URL(process.env.DATABASE_URL ?? "");
const direct = new URL(process.env.DIRECT_URL ?? "");

if (
  pool.hostname !== "ep-silent-waterfall-aowa1s8o-pooler.c-2.ap-southeast-1.aws.neon.tech" ||
  direct.hostname !== "ep-silent-waterfall-aowa1s8o.c-2.ap-southeast-1.aws.neon.tech" ||
  pool.pathname !== "/neondb" ||
  direct.pathname !== "/neondb"
) {
  console.error("run-fixture: database safety check failed; expected sibra-testing neondb URLs");
  process.exit(1);
}

pool.pathname = "/sibra_contract";
direct.pathname = "/sibra_contract";

console.log(pool.toString());
console.log(direct.toString());
')"

mapfile -t DB_URL_ARRAY <<< "$DB_URLS"

if [[ "${#DB_URL_ARRAY[@]}" -ne 2 ]]; then
  echo "run-fixture: could not safely resolve Neon TEST connection URLs"
  exit 1
fi

CONTRACT_POOL_URL="${DB_URL_ARRAY[0]}"
CONTRACT_DIRECT_URL="${DB_URL_ARRAY[1]}"

export CONTRACT_FIXTURE_DB="$FIXTURE_DB"
export CONTRACT_FIXTURE_ALLOWED_HOST="$EXPECTED_TEST_DIRECT_HOST"
export CONTRACT_BASE_URL="http://127.0.0.1:${PORT}"

# Runtime-generated fixture-admin credentials (never committed).
export CONTRACT_ADMIN_EMAIL="contract-admin@sibra.local"
export CONTRACT_ADMIN_PASSWORD="Fx$(openssl rand -hex 12)!Aa7"
# The fixture replays against the KNOWN 24-product demo catalog — opt into
# the demo seed explicitly (production-safe seed.ts default skips demo data).
export SEED_DEMO=true

INTERNAL_KEY="$(grep -E '^INTERNAL_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\"')"
if [ -z "$INTERNAL_KEY" ]; then echo "run-fixture: INTERNAL_API_KEY missing in backend/.env"; exit 1; fi

LOG="tests/contract/.fixture-server.log"
COOKIE="tests/contract/.admin-cookie"

echo "── fixture: recreating clean Neon TEST database ${FIXTURE_DB}"

# Database reset uses the verified DIRECT connection only.
export DATABASE_URL="$CONTRACT_DIRECT_URL"
export DIRECT_URL="$CONTRACT_DIRECT_URL"
bun tests/contract/fixture-db.ts reset

# Prisma migrations and application use pooled + direct connections.
export DATABASE_URL="$CONTRACT_POOL_URL"
export DIRECT_URL="$CONTRACT_DIRECT_URL"

echo "── fixture: prisma migrate deploy"
bunx prisma migrate deploy >/dev/null

echo "── fixture: seeding known catalog data"
bun prisma/seed.ts | tail -1

echo "── fixture: deterministic overrides (coords/admin/order)"
bun tests/contract/fixture-data.ts | tail -2

rm -f "$COOKIE"

echo "── fixture: booting backend on :${PORT} (dev mode)"
IMAGEKIT_PRIVATE_KEY="" \
NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY="" \
NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT="" \
IMAGEKIT_PRIVATE_KEY="" \
NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY="" \
NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT="" \
bunx next dev -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT

echo -n "── fixture: waiting for health"
READY=0
for _ in $(seq 1 120); do
  if curl -sf -H "x-internal-key: ${INTERNAL_KEY}" "${CONTRACT_BASE_URL}/api" 2>/dev/null | grep -q '"ok":true'; then READY=1; break; fi
  echo -n "."; sleep 2
done
echo
if [ "$READY" != "1" ]; then
  echo "run-fixture: server did not become healthy — last log lines:"; tail -20 "$LOG"; exit 1
fi
echo "── fixture: server healthy"

set +e
bun tests/contract/runner.ts "$MODE"
RUNNER_EXIT=$?
set -e

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
trap - EXIT

echo "── fixture: done (runner exit ${RUNNER_EXIT})"
exit "$RUNNER_EXIT"
