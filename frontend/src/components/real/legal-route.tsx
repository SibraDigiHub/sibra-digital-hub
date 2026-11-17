// ═══════════════════════════════════════════════════════════
// Shared factory for the four real legal routes (/privacy,
// /terms, /refund-policy, /contact). Each page renders the
// unchanged LegalView pinned to its page id — the same content
// the hash SPA shows, now server-rendered with its own metadata.
// (about/pricing keep their hash-only views — no real route.)
// ═══════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import RealRouteShell from '@/components/real/RealRouteShell'
import { legalMetadata } from '@/lib/seo-metadata'
import { LEGAL_PAGE_LABELS } from '@/lib/legal'
import type { RealLegalPage } from '@/lib/real-routes'

export function legalPageMetadata(page: RealLegalPage): Metadata {
  return legalMetadata(page, LEGAL_PAGE_LABELS[page])
}

export function LegalRoute({ page }: { page: RealLegalPage }) {
  return <RealRouteShell view="legal" legalPage={page} showFooter />
}
