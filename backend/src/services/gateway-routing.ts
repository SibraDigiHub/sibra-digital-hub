// ═══════════════════════════════════════════════════════════
// Gateway routing (single-gateway migration §6) — ONE pure
// function that decides the Razorpay currency + amount from
// the CONFIRMED billing country and the DB product. The client
// can never choose or override any of these; every unsupported
// combination gets a stable code + friendly message (marketplace
// buttons hint). No automatic conversion, ever.
//
//   India                → Razorpay / INR  (product.priceInr)
//   International, flag on → Razorpay / first configured
//     foreign currency (default USD, product.priceUsd). A configured
//     currency without a price field rejects gracefully until the
//     owner adds its price.
//   International, flag off → INTERNATIONAL_DISABLED (marketplace hint)
// ═══════════════════════════════════════════════════════════

import { internationalCheckoutEnabled, razorpayBlockedCountries, razorpayForeignCurrencies } from '@/config/env'
import { toMinor } from '@/lib/money'

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
  | 'NO_FOREIGN_PRICE' // configured foreign currency has no price source yet
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

/**
 * The authoritative routing rule (§6): India → Razorpay/INR, everywhere
 * else → Razorpay in the configured foreign currency, gated by
 * INTERNATIONAL_CHECKOUT_ENABLED. Prices always come from the product
 * row; missing prices are rejections, never conversions.
 */
export function resolveGateway(
  country: string | null | undefined,
  product: RoutableProduct,
  config: GatewayConfig,
): GatewayDecision {
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

  const [currency] = razorpayForeignCurrencies()
  if (!currency) return { ok: false, rejection: 'NO_FOREIGN_PRICE', message: MARKETPLACE_HINT }
  // The USD price field is the only foreign-currency price that exists today.
  // A configured non-USD currency has no admin price source yet — it rejects
  // gracefully until the owner adds one (charging the USD number in another
  // currency would be an unconverted, wrong amount).
  if (currency !== 'USD') return { ok: false, rejection: 'NO_FOREIGN_PRICE', message: MARKETPLACE_HINT }
  const usd = toMinor(product.priceUsd)
  if (usd === null) return { ok: false, rejection: 'NO_USD_PRICE', message: MARKETPLACE_HINT }
  return { ok: true, gateway: 'razorpay', currency, amountMinor: usd }
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
