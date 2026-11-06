'use client'

// ═══════════════════════════════════════════════════════════
// Gold / amber / mint / rose callout box with a lucide icon.
// ═══════════════════════════════════════════════════════════

import {
  Baby,
  Clock3,
  HeartHandshake,
  Info,
  Lock,
  Scale,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { LegalCalloutIcon, LegalTone } from '@/lib/legal/types'

const ICONS: Record<LegalCalloutIcon, LucideIcon> = {
  info: Info,
  shield: ShieldCheck,
  kids: Baby,
  lock: Lock,
  clock: Clock3,
  heart: HeartHandshake,
  scale: Scale,
}

const TONES: Record<LegalTone, { border: string; bg: string; icon: string }> = {
  gold: {
    border: 'border-[#E5B842]/45',
    bg: 'bg-[#E5B842]/[0.07]',
    icon: 'text-[#E5B842]',
  },
  amber: {
    border: 'border-[#FFB347]/45',
    bg: 'bg-[#FFB347]/[0.07]',
    icon: 'text-[#FFB347]',
  },
  mint: {
    border: 'border-[#34D399]/45',
    bg: 'bg-[#34D399]/[0.07]',
    icon: 'text-[#34D399]',
  },
  rose: {
    border: 'border-[#FB7185]/45',
    bg: 'bg-[#FB7185]/[0.07]',
    icon: 'text-[#FB7185]',
  },
}

export default function LegalCallout({
  tone,
  icon,
  title,
  text,
}: {
  tone: LegalTone
  icon: LegalCalloutIcon
  title: string
  text: string
}) {
  const Icon = ICONS[icon]
  const t = TONES[tone]
  return (
    <div className={`rounded-2xl border ${t.border} ${t.bg} px-4 py-4 md:px-5`}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/20 ${t.icon}`}
          aria-hidden="true"
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#F5F8F6] md:text-base">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-[#C7D0C9]">{text}</p>
        </div>
      </div>
    </div>
  )
}
