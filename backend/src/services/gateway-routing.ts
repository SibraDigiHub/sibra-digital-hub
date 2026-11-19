// ═══════════════════════════════════════════════════════════
// Server-authoritative gateway routing.
// India uses the admin-maintained INR price. International visitors use
// their country's native currency only when Razorpay supports it AND the
// merchant has enabled it; otherwise USD is the fallback. International
// prices are converted from product.priceUsd using a daily cached FX rate.
// The exact rounded minor-unit amount is snapshotted on the order.
// ═══════════════════════════════════════════════════════════

import { internationalCheckoutEnabled, razorpayBlockedCountries, razorpayForeignCurrencies } from '@/config/env'
import { toCurrencyMinor, toMinor } from '@/lib/money'
import { currencyForCountryCode } from '@/lib/country-currency'
import { usdExchangeRate } from '@/services/currency-rates'
import { isRazorpaySupportedCurrency } from '@/lib/razorpay'

/** 'paypal' is LEGACY ONLY — historical rows keep it readable; no new PayPal order can be created. */
export type Gateway = 'razorpay'

/** Minimal product slice the router needs (from the DB, never from the client). */
export interface RoutableProduct {
  instantDownload: boolean
  priceInr: number
  priceUsd: number
  deliverableUrl: string | null
  fullVideoUrl: string | null
  deliveryMode: string
}

export interface GatewayConfig {
  razorpayEnabled: boolean
}

export type QuoteRejection =
  | 'PRODUCT_NOT_INSTANT' // instant download turned off
  | 'PRODUCT_NOT_DELIVERABLE' // no deliverable configured
  | 'NO_INR_PRICE' // India but the INR price is missing/≤0
  | 'NO_USD_PRICE' // USD billed but the USD price is missing/≤0
  | 'NO_FOREIGN_PRICE' // no merchant-enabled supported currency has a usable FX rate
  | 'GATEWAY_DISABLED' // Razorpay is switched off
  | 'COUNTRY_BLOCKED' // RAZORPAY_BLOCKED_COUNTRIES (legacy alias honoured)
  | 'INTERNATIONAL_DISABLED' // INTERNATIONAL_CHECKOUT_ENABLED=false

export type GatewayDecision =
  | {
      ok: true
      gateway: Gateway
      currency: string
      amountMinor: number
    }
  | {
      ok: false
      rejection: QuoteRejection
      message: string
    }

const MARKETPLACE_HINT =
  "Direct purchase isn't available for your country yet — please use one of the marketplace buttons on the product page."

/** Normalize a country code: uppercase 2-letter ISO-3166 alpha-2 or null. */
export function normalizeCountry(country: string | null | undefined): string | null {
  if (!country) return null
  const c = country.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(c) ? c : null
}

export interface VisitorCurrencyChoice {
  currency: string
  rate: number
  rateUpdatedAt: number | null
}

/** Resolve the currency the merchant can actually charge for this country. */
export async function visitorCurrencyChoice(country: string): Promise<VisitorCurrencyChoice | null> {
  const native = currencyForCountryCode(country)
  const enabled = new Set(razorpayForeignCurrencies().filter(isRazorpaySupportedCurrency))
  const candidates = native && isRazorpaySupportedCurrency(native) && enabled.has(native) ? [native] : []
  if (!candidates.includes('USD') && enabled.has('USD')) candidates.push('USD')

  for (const currency of candidates) {
    const fx = await usdExchangeRate(currency)
    if (fx) return { currency, rate: fx.rate, rateUpdatedAt: fx.updatedAt }
  }
  return null
}

/**
 * Resolve the exact server-side currency and amount. FX is applied only to
 * the USD base price; India continues to use its separate INR base price.
 */
export async function resolveGateway(
  country: string | null | undefined,
  product: RoutableProduct,
  config: GatewayConfig,
): Promise<GatewayDecision> {
  const c = normalizeCountry(country)
  if (!product.instantDownload) {
    return { ok: false, rejection: 'PRODUCT_NOT_INSTANT', message: 'This product is not available for instant download.' }
  }
  if (product.deliveryMode !== 'watch' && !product.deliverableUrl) {
    return { ok: false, rejection: 'PRODUCT_NOT_DELIVERABLE', message: 'Deliverable file not configured yet — contact support.' }
  }
  if (product.deliveryMode === 'watch' && !product.fullVideoUrl) {
    return { ok: false, rejection: 'PRODUCT_NOT_DELIVERABLE', message: 'Protected video not configured yet — contact support.' }
  }

  if (c === 'IN') {
    const inr = toMinor(product.priceInr)
    if (inr === null) return { ok: false, rejection: 'NO_INR_PRICE', message: MARKETPLACE_HINT }
    if (!config.razorpayEnabled) return { ok: false, rejection: 'GATEWAY_DISABLED', message: MARKETPLACE_HINT }
    return { ok: true, gateway: 'razorpay', currency: 'INR', amountMinor: inr }
  }

  if (c === null) {
    // Without a confirmed country no currency can be chosen — ask for it.
    return { ok: false, rejection: 'COUNTRY_BLOCKED', message: 'Please confirm your billing country to continue.' }
  }

  if (razorpayBlockedCountries().has(c)) {
    return { ok: false, rejection: 'COUNTRY_BLOCKED', message: MARKETPLACE_HINT }
  }
  if (!internationalCheckoutEnabled()) {
    return {
      ok: false,
      rejection: 'INTERNATIONAL_DISABLED',
      message: "Direct international checkout isn't available yet — please use one of the marketplace buttons on the product page.",
    }
  }
  if (!config.razorpayEnabled) return { ok: false, rejection: 'GATEWAY_DISABLED', message: MARKETPLACE_HINT }

  const choice = await visitorCurrencyChoice(c)
  if (!choice) return { ok: false, rejection: 'NO_FOREIGN_PRICE', message: MARKETPLACE_HINT }
  if (choice.currency === 'USD') {
    const usd = toMinor(product.priceUsd)
    if (usd === null) return { ok: false, rejection: 'NO_USD_PRICE', message: MARKETPLACE_HINT }
    return { ok: true, gateway: 'razorpay', currency: 'USD', amountMinor: usd }
  }
  const usdBase = product.priceUsd
  if (typeof usdBase !== 'number' || !Number.isFinite(usdBase) || usdBase <= 0) {
    return { ok: false, rejection: 'NO_USD_PRICE', message: MARKETPLACE_HINT }
  }
  const amountMinor = toCurrencyMinor(usdBase * choice.rate, choice.currency)
  if (amountMinor === null) return { ok: false, rejection: 'NO_FOREIGN_PRICE', message: MARKETPLACE_HINT }
  return { ok: true, gateway: 'razorpay', currency: choice.currency, amountMinor }
}

/**
 * Gateway availability right now. Razorpay is "enabled" when the owner
 * has not switched it off AND (credentials exist OR we are in the key-less
 * demo environment — the demo flow must keep working end to end).
 */
export function gatewayConfigFromEnv(): GatewayConfig {
  const razorpayEnabled = process.env.RAZORPAY_ENABLED !== 'false'
  return { razorpayEnabled }
}
