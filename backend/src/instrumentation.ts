// Next.js instrumentation — runs once when the server boots
// (next dev / next start / Vercel runtime). Fails closed: if the
// environment is invalid (non-postgres URL, missing production secrets,
// ADMIN_REQUIRE_2FA=false in production) the process refuses to
// start with a clear, owner-actionable message.
export async function register(): Promise<void> {
  // Only enforce in the Node.js runtime (not edge, not build).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { getEnv } = await import('@/lib/env')
    const env = getEnv()
    // Re-audit B2: payment/demo/email boot guards live in config/env.ts.
    // Importing it here makes those checks run at BOOT (the module throws
    // on any production violation) instead of lazily on the first request.
    await import('@/config/env')
    // Ops visibility (not fatal): in production a missing CRON_SECRET means
    // the email-retry and reconcile crons answer 401 forever — stuck orders
    // and undelivered emails are then only repaired manually. Warn loudly.
    if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET) {
      console.warn('[env] WARNING — CRON_SECRET is not set: /api/cron/* (email retries, payment reconciliation) will always answer 401 in production. Set it and point your scheduler at those routes.')
    }
    if (!process.env.VERCEL) {
      console.log(
        `[env] OK — postgres-only · require2fa=${env.require2fa} · passkeys=${env.passkeysEnabled} · origins=${env.allowedOrigins.join(', ')}`,
      )
    }
  } catch (err) {
    console.error('════════════════════════════════════════════════')
    console.error((err as Error).message)
    console.error('════════════════════════════════════════════════')
    throw err
  }
}
