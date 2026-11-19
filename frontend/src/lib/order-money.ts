import type { Order } from '@/types/marketplace'

const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND'])
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase()
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0
  return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2
}

export function currencyDisplayDigits(currency: string): number {
  const exponent = currencyExponent(currency)
  return exponent === 3 ? 2 : exponent
}

export function formatMajorCurrency(amount: number, currency: string): string {
  const code = currency.toUpperCase()
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: currencyDisplayDigits(code),
  }).format(amount)
}

export function formatMinorCurrency(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase()
  const exponent = currencyExponent(code)
  const major = amountMinor / 10 ** exponent
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: currencyDisplayDigits(code),
  }).format(major)
}

export function formatOrderAmount(order: Pick<Order, 'currency' | 'amountMinor' | 'amountInr'>): string {
  const currency = order.currency ?? 'INR'
  if (order.amountMinor == null && currency !== 'INR') return '—'
  const amountMinor = order.amountMinor ?? Math.round(order.amountInr * 100)
  return formatMinorCurrency(amountMinor, currency)
}
