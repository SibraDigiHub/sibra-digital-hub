// GET /api — health/debug route (exempt from the x-internal-key guard).
// T7 (§8.7): returns BOOLEANS ONLY — { ok, db } where `ok` is the process
// answer and `db` a live `SELECT 1`. No message strings, no internals.
// P2: + { demoMode, testPaymentsAllowed } so the owner can verify after a
// deploy that no mock/sandbox flag silently degraded the store.
// NOTE: the contract `health` golden was re-captured for this body change.
import { NextResponse } from "next/server";
import { asHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { demoMode, testPaymentsAllowed } from "@/config/env";

export const dynamic = "force-dynamic";

export const GET = asHandler(async () => {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return NextResponse.json({ ok: true, db: dbOk, demoMode: demoMode(), testPaymentsAllowed: testPaymentsAllowed() });
});
