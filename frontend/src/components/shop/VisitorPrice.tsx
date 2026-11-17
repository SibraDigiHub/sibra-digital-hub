// Task 3 — one visitor price, never both.
//
// Renders the INR and USD twins with `sdh-p-*` classes; the pre-paint
// inline script sets <html data-currency> from the persistent sdh_geo
// cookie and the CSS shows exactly one span. Server HTML is geo-neutral
// (default USD — the crawler/unknown variant, consistent with the
// single USD JSON-LD Offer). React output is identical on server and
// client → hydration-safe by construction. Server still decides what
// is CHARGED; this only picks what is DISPLAYED.
export function VisitorPrice({
  usd,
  inr,
  inrClassName = '',
  usdClassName = '',
}: {
  usd: number
  inr: number
  inrClassName?: string
  usdClassName?: string
}) {
  return (
    <>
      <span className={`sdh-p-inr ${inrClassName}`}>₹{Math.round(inr)}</span>
      <span className={`sdh-p-usd ${usdClassName}`}>${usd.toFixed(2)}</span>
    </>
  )
}
