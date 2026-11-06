'use client'

// ═══════════════════════════════════════════════════════════
// Renders the typed legal sections: numbered headings with
// copy-link buttons, paragraphs, lists, callouts, tables and
// mail cards. Fades sections in on scroll (reduced-motion safe).
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { Check, Link2, Mail } from 'lucide-react'
import type { LegalBlock, LegalPageId, LegalSection } from '@/lib/legal/types'
import { resolveLine } from '@/lib/legal/shared'
import LegalCallout from './LegalCallout'
import LegalTable from './LegalTable'

function Block({ block, email }: { block: LegalBlock; email: string }) {
  if (block.kind === 'p') {
    const text = resolveLine(block.text, email)
    return text ? (
      <p className="max-w-[72ch] text-[15px] leading-[1.7] text-[#C7D0C9] md:text-[17px]">
        {text}
      </p>
    ) : null
  }
  if (block.kind === 'list') {
    const items = block.items
      .map((it) => resolveLine(it, email))
      .filter((it): it is string => it !== null)
    return (
      <ul className="max-w-[72ch] list-disc space-y-1.5 pl-5 text-[15px] leading-[1.7] text-[#C7D0C9] md:text-[17px]">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    )
  }
  if (block.kind === 'table') {
    const rows = block.rows.filter((r) =>
      r.every((c) => resolveLine(c, email) !== null),
    )
    return (
      <LegalTable
        columns={block.columns}
        rows={rows.map((r) => r.map((c) => resolveLine(c, email) as string))}
      />
    )
  }
  if (block.kind === 'callout') {
    const text = resolveLine(block.text, email)
    return text ? (
      <LegalCallout
        tone={block.tone}
        icon={block.icon}
        title={block.title}
        text={text}
      />
    ) : null
  }
  const subject = resolveLine(block.subject, email) ?? block.subject
  const body = block.body ? (resolveLine(block.body, email) ?? undefined) : undefined
  const label = resolveLine(block.label, email) ?? block.label
  return (
    <a
      href={`mailto:${email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`}
      className="glass inline-flex min-h-[48px] items-center gap-3 rounded-2xl px-5 py-3 font-semibold text-[#E5B842] transition-transform hover:scale-[1.02] focus-visible:outline-none"
    >
      <Mail className="h-5 w-5 shrink-0" aria-hidden="true" />
      {label}
    </a>
  )
}

export default function LegalSections({
  pageId,
  sections,
  email,
}: {
  pageId: LegalPageId
  sections: LegalSection[]
  email: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Scroll-reveal: add .legal-in when a section enters the viewport.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = Array.from(root.querySelectorAll('.legal-section'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('legal-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('legal-in')
            io.unobserve(e.target)
          }
        }),
      { rootMargin: '0px 0px -8% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [sections])

  const copyLink = async (id: string) => {
    const url = `${window.location.origin}/#/${pageId}?s=${id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 2000)
    } catch {
      /* clipboard unavailable — the deep link still works manually */
    }
  }

  return (
    <div ref={rootRef} className="space-y-12">
      {sections.map((s, i) => {
        const no = String(i + 1).padStart(2, '0')
        return (
          <section
            key={s.id}
            id={`sec-${s.id}`}
            data-legal-sec={s.id}
            aria-labelledby={`sec-${s.id}-h`}
            className="legal-section scroll-mt-28"
          >
            <div className="flex items-center gap-3">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-xs font-bold"
                style={{ borderColor: 'rgba(229,184,66,0.4)', color: '#E5B842' }}
                aria-hidden="true"
              >
                {no}
              </span>
              <h2
                id={`sec-${s.id}-h`}
                className="font-playfair text-xl font-bold text-[#F5F8F6] md:text-2xl"
              >
                {s.title}
              </h2>
              <button
                type="button"
                onClick={() => copyLink(s.id)}
                aria-label={`Copy link to section: ${s.title}`}
                className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#9AA89E] transition-colors hover:bg-white/5 hover:text-[#E5B842] focus-visible:outline-none"
              >
                {copiedId === s.id ? (
                  <Check className="h-4 w-4 text-[#34D399]" aria-hidden="true" />
                ) : (
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {s.blocks.map((b, bi) => (
                <Block key={`${s.id}-${bi}`} block={b} email={email} />
              ))}
            </div>
            <span aria-live="polite" className="sr-only">
              {copiedId === s.id ? 'Section link copied' : ''}
            </span>
          </section>
        )
      })}
    </div>
  )
}
