'use client'

// ═══════════════════════════════════════════════════════════
// Legal view — privacy / terms / refund-policy / contact.
// Premium reading experience on the obsidian shell: hero with
// chips, sticky scroll-spy TOC (mobile: collapsible), numbered
// sections, callouts, responsive tables, rights action card,
// prev/next, back-to-top, reading progress and print styles.
//
// NOTE: this app is a custom hash-router SPA — the TOC and
// skip link therefore use buttons / focus-move (never anchor
// hrefs) so location.hash is never disturbed.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronUp } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import {
  FALLBACK_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_PAGE_LABELS,
  LEGAL_PAGE_ORDER,
  LEGAL_VERSION,
  businessValues,
  fillTokens,
  formatLegalDate,
  getLegalPage,
  legalNeighbours,
  legalReadingMinutes,
} from '@/lib/legal'
import type { LegalPageId } from '@/lib/legal'
import LegalGlance from './legal/LegalGlance'
import LegalHero from './legal/LegalHero'
import LegalPriceList from './legal/LegalPriceList'
import LegalRightsCard from './legal/LegalRightsCard'
import LegalSections from './legal/LegalSections'
import LegalToc from './legal/LegalToc'

const ACCENTS: Record<string, string> = {
  kids: '#FFB347',
  creator: '#00F0FF',
}

export default function LegalView({ pageId }: { pageId?: LegalPageId }) {
  const storePage = useAppStore((s) => s.legalPage)
  // Real routes (/privacy, /terms, …) pin the page server-side; the hash
  // SPA keeps reading the store exactly as before.
  const legalPage = pageId ?? storePage
  const navigate = useAppStore((s) => s.navigate)
  const zone = useAppStore((s) => s.zone)
  const [email, setEmail] = useState(FALLBACK_EMAIL)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [showTop, setShowTop] = useState(false)

  const page = getLegalPage(legalPage)
  const accent = zone ? ACCENTS[zone] ?? '#E5B842' : '#E5B842'
  const vals = businessValues()
  const { prev, next } = legalNeighbours(page.id)
  const minutes = legalReadingMinutes(page)

  // Support e-mail from the existing settings API (owner-editable).
  useEffect(() => {
    let alive = true
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: { contactEmail?: string } } | null) => {
        if (!alive) return
        const e = data?.settings?.contactEmail
        if (typeof e === 'string' && e.includes('@')) setEmail(e)
      })
      .catch(() => {
        /* keep fallback */
      })
    return () => {
      alive = false
    }
  }, [])

  // Reading progress + back-to-top visibility.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0)
      setShowTop(window.scrollY > 600)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll-spy + deep-link (?s=<section>) once per page.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-legal-sec]'))
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveId(e.target.getAttribute('data-legal-sec'))
        }),
      { rootMargin: '-20% 0px -65% 0px' },
    )
    els.forEach((el) => io.observe(el))
    const first = page.sections[0]?.id ?? null
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('s')
    const target = q ? els.find((el) => el.getAttribute('data-legal-sec') === q) : null
    const t = window.setTimeout(() => {
      setActiveId(target?.getAttribute('data-legal-sec') ?? first)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => {
      io.disconnect()
      window.clearTimeout(t)
    }
  }, [page])

  const jump = (id: string) =>
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const goPage = (id: LegalPageId) => {
    navigate('legal', { legalPage: id })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const back = () => {
    const z = useAppStore.getState().zone
    if (z) navigate('shop', { zone: z, category: null })
    else navigate('gateway')
  }

  const pill = (id: LegalPageId, active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none ${
      active
        ? 'border bg-black/40'
        : 'glass text-[#C7D0C9] hover:text-[#F5F8F6]'
    }`

  return (
    <div className="legal-root mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
      {/* Reading progress */}
      <div
        aria-hidden="true"
        className="fixed left-0 top-0 z-50 h-0.5 print:hidden"
        style={{
          width: `${Math.round(progress * 100)}%`,
          background: `linear-gradient(90deg, ${accent}, #FAE8A7)`,
        }}
      />

      <a
        href="#legal-main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('legal-main')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[#E5B842] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-black print:hidden"
      >
        Skip to content
      </a>

      <button
        type="button"
        onClick={back}
        className="glass inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[#F5F8F6] transition-transform hover:scale-[1.03] focus-visible:outline-none print:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to shop
      </button>

      <div className="mt-6">
        <LegalHero
          icon={page.icon}
          title={page.title}
          tagline={fillTokens(page.tagline, email)}
          accent={accent}
          updated={formatLegalDate(LEGAL_LAST_UPDATED)}
          version={LEGAL_VERSION}
          minutes={minutes}
        />
      </div>

      <nav aria-label="Legal pages" className="mt-6 flex flex-wrap gap-2 print:hidden">
        {LEGAL_PAGE_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => goPage(id)}
            aria-current={page.id === id ? 'page' : undefined}
            className={pill(id, page.id === id)}
            style={page.id === id ? { borderColor: accent, color: '#FAE8A7' } : undefined}
          >
            {LEGAL_PAGE_LABELS[id]}
          </button>
        ))}
      </nav>

      <div className="mt-10 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <LegalToc sections={page.sections} activeId={activeId} accent={accent} onJump={jump} />

        <div id="legal-main" tabIndex={-1} className="min-w-0 outline-none">
          {page.showAtGlance && <LegalGlance accent={accent} />}

          <div className={page.showAtGlance ? 'mt-10' : ''}>
            <LegalSections pageId={page.id} sections={page.sections} email={email} />
          </div>

          {page.showPriceList && (
            <div className="mt-10">
              <LegalPriceList />
            </div>
          )}

          {page.showRightsCard && (
            <div className="mt-10">
              <LegalRightsCard email={email} />
            </div>
          )}

          <nav aria-label="More legal pages" className="mt-12 grid gap-3 sm:grid-cols-2 print:hidden">
            {prev ? (
              <button
                type="button"
                onClick={() => goPage(prev)}
                className="glass inline-flex min-h-[56px] items-center gap-3 rounded-2xl px-4 py-3 text-left transition-transform hover:scale-[1.02] focus-visible:outline-none"
              >
                <ArrowLeft className="h-4 w-4 shrink-0 text-[#E5B842]" aria-hidden="true" />
                <span>
                  <span className="block text-[11px] uppercase tracking-wider text-[#9AA89E]">
                    Previous
                  </span>
                  <span className="font-semibold text-[#F5F8F6]">{LEGAL_PAGE_LABELS[prev]}</span>
                </span>
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            {next ? (
              <button
                type="button"
                onClick={() => goPage(next)}
                className="glass inline-flex min-h-[56px] items-center justify-end gap-3 rounded-2xl px-4 py-3 text-right transition-transform hover:scale-[1.02] focus-visible:outline-none sm:col-start-2"
              >
                <span>
                  <span className="block text-[11px] uppercase tracking-wider text-[#9AA89E]">
                    Next
                  </span>
                  <span className="font-semibold text-[#F5F8F6]">{LEGAL_PAGE_LABELS[next]}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[#E5B842]" aria-hidden="true" />
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </nav>
        </div>
      </div>

      <p className="glass mt-12 rounded-2xl px-5 py-4 text-sm leading-relaxed text-[#F5F8F6]">
        Questions? Email us at{' '}
        <a
          href={`mailto:${email}`}
          className="font-semibold text-[#E5B842] underline-offset-4 hover:underline"
        >
          {email}
        </a>{' '}
        — {vals.responseTime}
      </p>

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="glass fixed bottom-6 right-6 z-40 grid h-11 w-11 place-items-center rounded-full text-[#E5B842] transition-transform hover:scale-110 focus-visible:outline-none print:hidden"
        >
          <ChevronUp className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
