// ═══════════════════════════════════════════════════════════
// Legal content types — single source of truth for the six
// legal pages. Content lives in sibling data files; the
// renderer (components/legal/*) maps these to UI.
// ═══════════════════════════════════════════════════════════

export type LegalPageId =
  | 'about'
  | 'pricing'
  | 'privacy'
  | 'terms'
  | 'refund-policy'
  | 'contact'

export type LegalTone = 'gold' | 'amber' | 'mint' | 'rose'

export type LegalCalloutIcon =
  | 'info'
  | 'shield'
  | 'kids'
  | 'lock'
  | 'clock'
  | 'heart'
  | 'scale'

/** Tokens like {{email}} are filled at render time; lines whose
 *  tokens cannot be resolved (owner value not set yet) are dropped,
 *  so the pages never show fake or placeholder business data. */
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; columns: [string, ...string[]]; rows: string[][] }
  | {
      kind: 'callout'
      tone: LegalTone
      icon: LegalCalloutIcon
      title: string
      text: string
    }
  | { kind: 'mail-card'; subject: string; label: string; body?: string }

export interface LegalSection {
  id: string
  title: string
  blocks: LegalBlock[]
}

export interface LegalPageData {
  id: LegalPageId
  title: string
  /** One-line friendly summary under the page title. */
  tagline: string
  icon: 'shield' | 'scroll' | 'refresh' | 'mail' | 'sparkles' | 'tag'
  showAtGlance?: boolean
  showRightsCard?: boolean
  /** Pricing page: render the live catalog price list under the sections. */
  showPriceList?: boolean
  sections: LegalSection[]
}
