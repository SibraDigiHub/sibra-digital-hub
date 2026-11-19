'use client'

import { useVisitorCurrency, formatVisitorPrice } from '@/lib/visitor-currency'

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
  const currency = useVisitorCurrency()
  if (!currency) return null

  const className = currency === 'INR' ? inrClassName : usdClassName
  return <span className={className}>{formatVisitorPrice(currency, usd, inr)}</span>
}
