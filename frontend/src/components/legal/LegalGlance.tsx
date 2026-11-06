'use client'

// ═══════════════════════════════════════════════════════════
// "At a glance" — four verified promises shown on the Privacy
// page hero area. Icons from lucide, no images.
// ═══════════════════════════════════════════════════════════

import { CreditCard, ShieldCheck, Sprout, UserCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AT_A_GLANCE } from '@/lib/legal/shared'

const ICONS: Record<string, LucideIcon> = {
  sprout: Sprout,
  card: CreditCard,
  shield: ShieldCheck,
  user: UserCheck,
}

export default function LegalGlance({ accent }: { accent: string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Privacy at a glance">
      {AT_A_GLANCE.map((g) => {
        const Icon = ICONS[g.icon] ?? ShieldCheck
        return (
          <li
            key={g.icon}
            className="glass flex items-start gap-3 rounded-2xl px-4 py-4 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/25"
              style={{ color: accent }}
              aria-hidden="true"
            >
              <Icon className="h-4.5 w-4.5" />
            </span>
            <p className="text-sm leading-relaxed text-[#C7D0C9]">{g.text}</p>
          </li>
        )
      })}
    </ul>
  )
}
