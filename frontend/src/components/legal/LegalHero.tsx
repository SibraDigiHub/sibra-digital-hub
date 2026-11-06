'use client'

// ═══════════════════════════════════════════════════════════
// Legal hero: gold-ringed icon badge, title, friendly summary
// and chips (Last updated · Version · reading time). Soft CSS
// shimmer, disabled under prefers-reduced-motion.
// ═══════════════════════════════════════════════════════════

import { CalendarDays, Clock3, Mail, RotateCw, ScrollText, ShieldCheck, Sparkles, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  shield: ShieldCheck,
  scroll: ScrollText,
  refresh: RotateCw,
  mail: Mail,
  sparkles: Sparkles,
  tag: Tag,
}

export default function LegalHero({
  icon,
  title,
  tagline,
  accent,
  updated,
  version,
  minutes,
}: {
  icon: string
  title: string
  tagline: string
  accent: string
  updated: string
  version: string
  minutes: number
}) {
  const Icon = ICONS[icon] ?? ShieldCheck
  const chip =
    'inline-flex items-center gap-1.5 rounded-full border border-[rgba(229,184,66,0.3)] bg-black/30 px-3 py-1.5 text-xs font-medium text-[#C7D0C9]'
  return (
    <header
      className="legal-hero-glow glass rounded-3xl px-5 py-7 md:px-8 md:py-9"
      style={{
        backgroundImage: `linear-gradient(120deg, ${accent}1f, rgba(255,255,255,0.02) 45%, ${accent}14)`,
      }}
    >
      <div className="flex items-start gap-4">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border bg-black/30 md:h-16 md:w-16"
          style={{ borderColor: `${accent}66`, boxShadow: `0 0 36px ${accent}30` }}
          aria-hidden="true"
        >
          <Icon className="h-7 w-7" style={{ color: accent }} />
        </span>
        <div className="min-w-0">
          <h1 className="font-playfair text-3xl font-bold text-[#FAE8A7] md:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-[#9AA89E] md:text-base">
            {tagline}
          </p>
        </div>
      </div>
      <ul className="mt-5 flex flex-wrap gap-2" aria-label="Document metadata">
        <li className={chip}>
          <CalendarDays className="h-3.5 w-3.5 text-[#E5B842]" aria-hidden="true" />
          Last updated {updated}
        </li>
        <li className={chip}>
          <Tag className="h-3.5 w-3.5 text-[#E5B842]" aria-hidden="true" />
          Version {version}
        </li>
        <li className={chip}>
          <Clock3 className="h-3.5 w-3.5 text-[#E5B842]" aria-hidden="true" />
          {minutes} min read
        </li>
      </ul>
    </header>
  )
}
