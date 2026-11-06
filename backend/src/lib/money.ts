// ═══════════════════════════════════════════════════════════
// Money helpers (dual payment §2.1/§4) — integer minor units
// are the ONLY billed representation. Floats are converted at
// exactly one place (here) so every gateway call and every
// comparison uses the same rounding (half-up via Math.round).
// ═══════════════════════════════════════════════════════════

/** Float major units → integer minor units (299.00 → 29900). Null when not a positive finite number. */
export function toMinor(major: number | null | undefined): number | null {
  if (typeof major !== 'number' || !Number.isFinite(major) || major <= 0) return null
  return Math.round(major * 100)
}

/** Minor units → display string for the quote line ("₹499" / "$5.99"). */
export function formatMinor(minor: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `
  const major = minor / 100
  const text = minor % 100 === 0 ? String(major) : major.toFixed(2)
  return `${symbol}${text}`
}

/**
 * The authoritative billed minor units for a Razorpay order (re-audit B5):
 * the integer minor-units snapshot when present, else the legacy Float
 * snapshot converted in exactly one place. Client display values are
 * never consulted. Currency-agnostic: INR paise, USD cents, or any
 * configured foreign currency's minor units (snapshot is authoritative).
 */
export function orderExpectedMinor(order: { amountMinor: number | null; amountInr: number }): number {
  return order.amountMinor ?? Math.round(order.amountInr * 100)
}
