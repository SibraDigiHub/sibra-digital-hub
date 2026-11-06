'use client'

// ═══════════════════════════════════════════════════════════
// Table of contents: sticky scroll-spy list on desktop,
// collapsible "On this page" on mobile. Buttons (not anchor
// hrefs) so the hash router is never confused.
// ═══════════════════════════════════════════════════════════

import { ChevronDown, ListTree } from 'lucide-react'
import type { LegalSection } from '@/lib/legal/types'

function no(i: number): string {
  return String(i + 1).padStart(2, '0')
}

function TocButtons({
  sections,
  activeId,
  accent,
  onJump,
}: {
  sections: LegalSection[]
  activeId: string | null
  accent: string
  onJump: (id: string) => void
}) {
  return (
    <ol className="space-y-1">
      {sections.map((s, i) => {
        const active = activeId === s.id
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none ${
                active
                  ? 'bg-white/5 font-semibold text-[#F5F8F6]'
                  : 'text-[#9AA89E] hover:bg-white/5 hover:text-[#F5F8F6]'
              }`}
            >
              <span
                className="h-4 w-0.5 shrink-0 rounded-full transition-colors"
                style={{ backgroundColor: active ? accent : 'rgba(255,255,255,0.15)' }}
                aria-hidden="true"
              />
              <span className="text-[10px] font-bold tabular-nums opacity-70">{no(i)}</span>
              <span className="min-w-0">{s.title}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export default function LegalToc({
  sections,
  activeId,
  accent,
  onJump,
}: {
  sections: LegalSection[]
  activeId: string | null
  accent: string
  onJump: (id: string) => void
}) {
  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav
        aria-label="On this page"
        className="hidden lg:sticky lg:top-28 lg:block lg:self-start"
      >
        <p className="mb-3 flex items-center gap-2 px-3 text-xs font-bold uppercase tracking-[0.18em] text-[#E5B842]">
          <ListTree className="h-4 w-4" aria-hidden="true" />
          On this page
        </p>
        <TocButtons sections={sections} activeId={activeId} accent={accent} onJump={onJump} />
      </nav>

      {/* Mobile: collapsible */}
      <details className="glass group rounded-2xl px-4 py-1 lg:hidden">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-bold text-[#F5F8F6] [&::-webkit-details-marker]:hidden">
          <ListTree className="h-4 w-4 text-[#E5B842]" aria-hidden="true" />
          On this page
          <ChevronDown
            className="ml-auto h-4 w-4 text-[#9AA89E] transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="py-2">
          <TocButtons
            sections={sections}
            activeId={activeId}
            accent={accent}
            onJump={(id) => {
              onJump(id)
            }}
          />
        </div>
      </details>
    </>
  )
}
