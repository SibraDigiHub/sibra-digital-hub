// ═══════════════════════════════════════════════════════════
// Legal shared values — the ONE place where the version date,
// version number, page order and business values live.
//
// Business details come from NEXT_PUBLIC_* env names (see
// frontend/.env.example + docs/LEGAL_PAGES.md). Owner-provided values
// (name, postal address, jurisdiction) are committed below so they also
// render in the browser, where dynamic env reads are not inlined; env
// vars still override them when set. Values that remain unset (phone)
// resolve to empty strings and any line that still contains a {{token}}
// is dropped by the renderer — never fake data on the page.
// ═══════════════════════════════════════════════════════════

import type { LegalPageId } from './types'

/** The day this legal content was published (single constant). */
export const LEGAL_LAST_UPDATED = '2026-11-05'

/** Content version shown in the hero chip. */
export const LEGAL_VERSION = '2.2'

export const LEGAL_PAGE_ORDER: LegalPageId[] = [
  'about',
  'pricing',
  'privacy',
  'terms',
  'refund-policy',
  'contact',
]

export const LEGAL_PAGE_LABELS: Record<LegalPageId, string> = {
  about: 'About Us',
  pricing: 'Pricing',
  privacy: 'Privacy',
  terms: 'Terms',
  'refund-policy': 'Refund & Delivery',
  contact: 'Contact',
}

export const BUSINESS_NAME = 'Sibra Digital Hub'

/** The legal owner/operator of the business (committed so it also
 *  renders in the browser, where dynamic env reads are not inlined).
 *  NEXT_PUBLIC_LEGAL_OWNER_NAME still overrides it when set. */
export const LEGAL_OWNER_NAME = 'Azaz Mohammad'

/** Postal address shown publicly. Owner decision 05 Nov 2026: a full street
 *  address must NOT be published on a public website (privacy) — the short
 *  state/country form is the committed default; a fuller address can still be
 *  supplied via NEXT_PUBLIC_BUSINESS_ADDRESS without a code change.
 *  Renders on Privacy → “Who we are” and Contact → “Grievance redressal”. */
export const BUSINESS_ADDRESS = 'West Bengal, India'

/** Courts with exclusive jurisdiction (Terms → “Governing law”). Derived
 *  from the owner’s district above; NEXT_PUBLIC_LEGAL_JURISDICTION
 *  still overrides it when set. */
export const LEGAL_JURISDICTION = 'North 24 Parganas, West Bengal, India'

/** Fallback while /api/settings is loading (same as the footer). */
export const FALLBACK_EMAIL = 'support@sibradigitalhub.com'

/**
 * Response-time promise. Owner can override with
 * NEXT_PUBLIC_PRIVACY_RESPONSE_TIME_TEXT; the default follows the
 * agreed wording (3 working days to acknowledge, 30 days to complete).
 */
export const DEFAULT_RESPONSE_TIME =
  'We acknowledge every request within 3 working days and complete it within 30 days — usually much sooner.'

export interface LegalBusinessValues {
  businessName: string
  ownerName: string
  address: string
  supportPhone: string
  grievanceOfficer: string
  jurisdiction: string
  responseTime: string
}

/** Reads the optional NEXT_PUBLIC_* business values once per render. */
export function businessValues(): LegalBusinessValues {
  const env = (name: string): string =>
    (typeof process !== 'undefined' && process.env[name]) || ''
  return {
    businessName: BUSINESS_NAME,
    ownerName: env('NEXT_PUBLIC_LEGAL_OWNER_NAME') || LEGAL_OWNER_NAME,
    address: env('NEXT_PUBLIC_BUSINESS_ADDRESS') || BUSINESS_ADDRESS,
    supportPhone: env('NEXT_PUBLIC_SUPPORT_PHONE'),
    grievanceOfficer:
      env('NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME') || LEGAL_OWNER_NAME,
    jurisdiction: env('NEXT_PUBLIC_LEGAL_JURISDICTION') || LEGAL_JURISDICTION,
    responseTime:
      env('NEXT_PUBLIC_PRIVACY_RESPONSE_TIME_TEXT') || DEFAULT_RESPONSE_TIME,
  }
}

/** Values that are always known (never dropped). */
export function fillTokens(text: string, email: string): string {
  const v = businessValues()
  return text
    .replaceAll('{{businessName}}', v.businessName)
    .replaceAll('{{ownerName}}', v.ownerName)
    .replaceAll('{{address}}', v.address)
    .replaceAll('{{supportPhone}}', v.supportPhone)
    .replaceAll('{{grievanceOfficer}}', v.grievanceOfficer)
    .replaceAll('{{jurisdiction}}', v.jurisdiction)
    .replaceAll('{{responseTime}}', v.responseTime)
    .replaceAll('{{email}}', email)
}

/** A line with a token that is missing or resolves to an empty value is
 *  omitted — never render half-filled business data (e.g. "Postal address:"
 *  with nothing after it). Unknown token names are treated as unresolved. */
export function resolveLine(text: string, email: string): string | null {
  const v = businessValues()
  const values: Record<string, string> = {
    businessName: v.businessName,
    ownerName: v.ownerName,
    address: v.address,
    supportPhone: v.supportPhone,
    grievanceOfficer: v.grievanceOfficer,
    jurisdiction: v.jurisdiction,
    responseTime: v.responseTime,
    email,
  }
  const hasEmpty = [...text.matchAll(/\{\{(\w+)\}\}/g)].some(
    (m) => !(values[m[1]] ?? '').trim(),
  )
  if (hasEmpty) return null
  const out = fillTokens(text, email)
  return /\{\{/.test(out) ? null : out
}

/** "2026-10-25" → "25 Oct 2026" for the hero chip. */
export function formatLegalDate(iso: string): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return iso
  return `${d} ${months[m - 1]} ${y}`
}

/** At-a-glance promises (Privacy hero) — each is verified in code. */
export const AT_A_GLANCE: {
  icon: 'sprout' | 'card' | 'shield' | 'user'
  text: string
}[] = [
  {
    icon: 'sprout',
    text: 'We collect only what a delivery needs — your name, e-mail and order details.',
  },
  {
    icon: 'card',
    text: 'We never see your card number or UPI PIN — Razorpay Checkout handles the payment.',
  },
  {
    icon: 'shield',
    text: 'No advertising trackers, no profiling, and we never sell your data — anywhere.',
  },
  {
    icon: 'user',
    text: 'You stay in control — ask us anytime to access, correct or erase your data.',
  },
]
