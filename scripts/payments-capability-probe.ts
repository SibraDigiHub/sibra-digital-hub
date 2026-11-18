// ═══════════════════════════════════════════════════════════
// payments-capability-probe.ts — Razorpay capability probe.
//
//   bun scripts/payments-capability-probe.ts
//
// Answers ONE question for the owner: which currencies does THIS
// Razorpay merchant account currently accept for Orders API
// creation? Run it AFTER changing anything merchant-side
// (International Payments activation, PayPal linking, new
// currency enablement) so the checkout flags can be set on facts.
//
// Rules (master prompt §4.2b):
//   • TEST MODE ONLY — a live key refuses to run unless the
//     explicit --allow-live flag is passed (never in CI).
//   • Creates ₹1 / $1 (100 minor units) test orders via
//     POST /v1/orders and reports accept/reject verbatim.
//   • No secrets are ever printed; the key id is masked.
//   • The Orders API does not expose payable METHODS (UPI/cards/
//     PayPal) — that stays a dashboard/documentation check below.
// ═══════════════════════════════════════════════════════════

import { pass, fail, printCheckTable, type Check } from "./_lib"

const RZP_BASE = process.env.RAZORPAY_API_BASE?.trim() || "https://api.razorpay.com"

interface ProbeArgs {
  allowLive: boolean
}

function parseArgs(argv: string[]): ProbeArgs {
  return { allowLive: argv.includes("--allow-live") }
}

function maskKeyId(keyId: string): string {
  if (keyId.length <= 12) return "rzp_****"
  return `${keyId.slice(0, 10)}…${keyId.slice(-4)}`
}

interface ProbeResult {
  currency: string
  ok: boolean
  detail: string
  ms: number
}

async function probeCurrency(
  auth: string,
  currency: string,
  base: string,
): Promise<ProbeResult> {
  const started = Date.now()
  const receipt = `probe-${Date.now()}`
  try {
    const res = await fetch(`${base}/v1/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ amount: 100, currency, receipt, notes: { purpose: "capability-probe" } }),
      signal: AbortSignal.timeout(10_000),
    })
    const ms = Date.now() - started
    const body = (await res.json().catch(() => ({}))) as {
      id?: string
      error?: { code?: string; description?: string; reason?: string }
    }
    if (res.ok && body.id) {
      return { currency, ok: true, detail: `accepted — test order ${body.id.slice(0, 14)}… created`, ms }
    }
    const err = body.error
    const detail = err
      ? `rejected — ${err.code ?? res.status}: ${err.description ?? err.reason ?? "no description"}`
      : `rejected — HTTP ${res.status} (unreadable body)`
    return { currency, ok: false, detail, ms }
  } catch (e) {
    const ms = Date.now() - started
    const msg = e instanceof Error ? e.message : String(e)
    return { currency, ok: false, detail: `network/timeout — ${msg}`, ms }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? ""
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? ""
  const mode = process.env.RAZORPAY_MODE?.trim().toLowerCase()

  const checks: Check[] = []

  if (!keyId || !keySecret) {
    console.log(
      "CAPABILITY PROBE — skipped: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set in this shell.\n" +
        "Run it with the owner's TEST credentials exported (gitignored env only), e.g.:\n" +
        "  set -a; . backend/.env; set +a; bun scripts/payments-capability-probe.ts",
    )
    process.exit(0)
  }

  const isLiveKey = keyId.startsWith("rzp_live_") || mode === "live"
  if (isLiveKey && !args.allowLive) {
    console.log(
      "CAPABILITY PROBE — REFUSED: a LIVE key is configured. This probe exists for TEST mode.\n" +
        "If you truly intend to create real ₹1 orders on the live account, pass --allow-live explicitly.",
    )
    process.exit(1)
  }

  checks.push(pass("mode", "key posture", `${isLiveKey ? "LIVE (--allow-live given)" : "test"} · key ${maskKeyId(keyId)} · api ${RZP_BASE === "https://api.razorpay.com" ? "production Razorpay" : RZP_BASE}`))

  const foreign = (process.env.RAZORPAY_FOREIGN_CURRENCIES?.split(",") ?? ["USD"])
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c))
  const currencies = ["INR", ...foreign.filter((c) => c !== "INR")]

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64")
  const results: ProbeResult[] = []
  for (const currency of currencies) {
    const r = await probeCurrency(auth, currency, RZP_BASE)
    results.push(r)
    checks.push(
      r.ok
        ? pass(`cur-${currency}`, `${currency} ₹1/$1 test order`, r.detail, r.ms)
        : fail(`cur-${currency}`, `${currency} ₹1/$1 test order`, r.detail, r.ms),
    )
  }

  printCheckTable("Razorpay capability probe (Orders API, test mode)", checks)

  const intlAccepted = results.find((r) => r.currency !== "INR")?.ok ?? false
  console.log("")
  console.log("Reading the results:")
  console.log("  • INR accepted        → India checkout is ready (RAZORPAY_MODE=test, keys valid).")
  console.log(
    intlAccepted
      ? "  • Foreign accepted    → Razorpay International IS active for this account: set INTERNATIONAL_CHECKOUT_ENABLED=true on the server after adding the foreign currency in the Dashboard."
      : "  • Foreign rejected    → Razorpay International is NOT active yet (or the currency is not enabled). Keep INTERNATIONAL_CHECKOUT_ENABLED=false; non-India buyers see the marketplace fallback.",
  )
  console.log("  • Payment METHODS (UPI/cards/netbanking/PayPal) are not exposed by the Orders API —")
  console.log("    confirm the enabled methods + card networks in the Razorpay Dashboard and with Razorpay support")
  console.log("    (needs documentation verification — see docs/RAZORPAY_SETUP.md §3).")
  console.log("  • Probe orders are ₹1/$1 TEST orders — settle nothing, delete them in the Dashboard if you like.")
}

void main()
