// Money helpers — integer minor units are the ONLY billed representation.
// Currency exponents follow Razorpay's documented supported-currency table.
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  AED:2, ALL:2, AMD:2, AUD:2, AWG:2, AZN:2, BAM:2, BBD:2, BDT:2, BGN:2,
  BHD:3, BIF:0, BMD:2, BND:2, BOB:2, BRL:2, BSD:2, BTN:2, BWP:2, BZD:2,
  CAD:2, CHF:2, CLP:0, CNY:2, COP:2, CRC:2, CUP:2, CVE:2, CZK:2, DJF:0,
  DKK:2, DOP:2, DZD:2, EGP:2, ETB:2, EUR:2, FJD:2, GBP:2, GHS:2, GIP:2,
  GMD:2, GNF:0, GTQ:2, GYD:2, HKD:2, HNL:2, HRK:2, HTG:2, HUF:2, IDR:2,
  ILS:2, INR:2, IQD:3, ISK:0, JMD:2, JOD:3, JPY:0, KES:2, KGS:2, KHR:2,
  KMF:0, KRW:0, KWD:3, KYD:2, KZT:2, LAK:2, LKR:2, LRD:2, LSL:2, MAD:2,
  MDL:2, MGA:2, MKD:2, MMK:2, MNT:2, MOP:2, MUR:2, MVR:2, MWK:2, MXN:2,
  MYR:2, MZN:2, NAD:2, NGN:2, NIO:2, NOK:2, NPR:2, NZD:2, OMR:3, PEN:2,
  PGK:2, PHP:2, PKR:2, PLN:2, PYG:0, QAR:2, RON:2, RSD:2, RUB:2, RWF:0,
  SAR:2, SCR:2, SEK:2, SGD:2, SLL:2, SOS:2, SVC:2, SZL:2, THB:2, TND:3,
  TRY:2, TTD:2, TWD:2, TZS:2, UAH:2, UGX:0, USD:2, UYU:2, UZS:2, VND:0,
  VUV:0, XAF:0, XCD:2, XOF:0, XPF:0, YER:2, ZAR:2, ZMW:2,
}

/** 10^ISO exponent for a known currency, or null when not in the supported table. */
export function currencyExponentFactor(currency: string): number | null {
  const exponent = CURRENCY_EXPONENTS[currency.toUpperCase()]
  return exponent === undefined ? null : 10 ** exponent
}

/** Float major units → integer minor units (legacy 2-decimal helper). */
export function toMinor(major: number | null | undefined): number | null {
  if (typeof major !== 'number' || !Number.isFinite(major) || major <= 0) return null
  return Math.round(major * 100)
}

/** Major units → integer minor units using the currency's exponent. */
export function toCurrencyMinor(major: number, currency: string): number | null {
  if (typeof major !== 'number' || !Number.isFinite(major) || major <= 0) return null
  const factor = currencyExponentFactor(currency)
  if (factor === null) return null
  const rounded = Math.round(major * factor)
  // Razorpay's three-decimal currency guidance requires the final minor-unit
  // digit to be 0 (e.g. 99.991 KWD -> 99990, not 99991).
  return factor === 1000 ? Math.round(rounded / 10) * 10 : rounded
}

/** Minor units → localized display string using the currency's exponent. */
export function formatMinor(minor: number, currency: string): string {
  const factor = currencyExponentFactor(currency)
  if (factor === null || !Number.isSafeInteger(minor) || minor < 0) return `${currency} ${minor}`
  const major = minor / factor
  const exponent = Math.round(Math.log10(factor))
  const displayDigits = exponent === 3 ? 2 : exponent
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDigits,
  }).format(major)
}

/** Authoritative billed minor units stored on an order; legacy fallback retained. */
export function orderExpectedMinor(order: { amountMinor: number | null; amountInr: number }): number {
  return order.amountMinor ?? Math.round(order.amountInr * 100)
}
