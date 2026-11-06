// ═══════════════════════════════════════════════════════════
// Legal content registry — one import point for the views.
// Content, date and version live in lib/legal/* only.
// ═══════════════════════════════════════════════════════════

import type { LegalPageData, LegalPageId } from './types'
import { ABOUT_PAGE } from './about'
import { PRIVACY_PAGE } from './privacy'
import { PRICING_PAGE } from './pricing'
import { TERMS_PAGE } from './terms'
import { REFUND_PAGE } from './refund'
import { CONTACT_PAGE } from './contact'
import {
  LEGAL_PAGE_ORDER,
  LEGAL_PAGE_LABELS,
  LEGAL_LAST_UPDATED,
  LEGAL_VERSION,
} from './shared'

export * from './types'
export * from './shared'

const PAGES: Record<LegalPageId, LegalPageData> = {
  about: ABOUT_PAGE,
  pricing: PRICING_PAGE,
  privacy: PRIVACY_PAGE,
  terms: TERMS_PAGE,
  'refund-policy': REFUND_PAGE,
  contact: CONTACT_PAGE,
}

export function getLegalPage(id: string | null | undefined): LegalPageData {
  const key = (LEGAL_PAGE_ORDER as string[]).includes(id ?? '')
    ? (id as LegalPageId)
    : 'about'
  return PAGES[key]
}

export function legalNeighbours(id: LegalPageId): {
  prev: LegalPageId | null
  next: LegalPageId | null
} {
  const i = LEGAL_PAGE_ORDER.indexOf(id)
  return {
    prev: i > 0 ? LEGAL_PAGE_ORDER[i - 1] : null,
    next: i < LEGAL_PAGE_ORDER.length - 1 ? LEGAL_PAGE_ORDER[i + 1] : null,
  }
}

export function legalReadingMinutes(page: LegalPageData): number {
  let words = 0
  const count = (t: string) => (t ? t.split(/\s+/).length : 0)
  for (const s of page.sections) {
    for (const b of s.blocks) {
      if (b.kind === 'p' || b.kind === 'callout') words += count(b.text)
      if (b.kind === 'list') b.items.forEach((it) => (words += count(it)))
      if (b.kind === 'table')
        b.rows.forEach((r) => r.forEach((c) => (words += count(c))))
    }
  }
  return Math.max(1, Math.round(words / 200))
}

export { LEGAL_PAGE_LABELS, LEGAL_PAGE_ORDER, LEGAL_LAST_UPDATED, LEGAL_VERSION }
