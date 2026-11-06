'use client'

// ═══════════════════════════════════════════════════════════
// Dual-tagline RTL marquee ticker (PRD §6) — shown ONLY on the
// shop (home) views of both zones, never on detail pages.
// It renders in normal flow (NOT sticky) so it can never
// overlap the Kids Zone / Creator Hub section buttons — it
// simply scrolls away with the page. Zone-aware skin: a warm
// amber band on Kids, an obsidian-neon band on Creator.
// Texts come from /api/settings with instant local fallbacks.
// ═══════════════════════════════════════════════════════════

import { Fragment, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useMarqueeFallback } from '@/hooks/useMarqueeFallback'
import type { Zone } from '@/types/marketplace'

interface TickerItem {
  id: string
  badge: string
  badgeClass: string
  text: string
  zone: Zone
}

function TickerGroup({
  items,
  goZone,
  hidden,
}: {
  items: TickerItem[]
  goZone: (z: Zone) => void
  hidden?: boolean
}) {
  return (
    <div className="flex items-center" aria-hidden={hidden || undefined}>
      {items.map((it) => (
        <Fragment key={it.id}>
          <button
            type="button"
            tabIndex={hidden ? -1 : 0}
            onClick={() => goZone(it.zone)}
            className="flex min-h-[44px] items-center gap-2 px-3 text-xs transition-colors focus-visible:outline-none md:text-sm"
          >
            <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-bold md:text-xs ${it.badgeClass}`}>
              {it.badge}
            </span>
            <span className="whitespace-nowrap">{it.text}</span>
          </button>
          <span aria-hidden="true" className="ticker-sep px-2">
            •
          </span>
        </Fragment>
      ))}
    </div>
  )
}

export default function TickerBar() {
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.zone)
  const navigate = useAppStore((s) => s.navigate)
  const trackRef = useRef<HTMLDivElement | null>(null)
  // Self-healing marquee: keeps the ribbon gliding even on
  // devices that suppress CSS animations (reduced-motion).
  // Re-attaches whenever the shop view (re)mounts the track.
  useMarqueeFallback(trackRef, 45, [view])
  const [kids, setKids] = useState('Interactive E-Books, Puzzles, ABCD & Fun Coloring Books for Little Minds!')
  const [creator, setCreator] = useState('Premium Canva Templates, High-Converting AI Prompts, Scripts & Responsive Web Designs!')
  const [assets, setAssets] = useState('High-Quality Premium Downloads for Curious Minds & Professionals Aligned!')

  useEffect(() => {
    let alive = true
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: Record<string, unknown> } | null) => {
        if (!alive || !data?.settings) return
        const s = data.settings
        if (typeof s.tickerKidsText === 'string' && s.tickerKidsText) setKids(s.tickerKidsText)
        if (typeof s.tickerCreatorText === 'string' && s.tickerCreatorText) setCreator(s.tickerCreatorText)
        if (typeof s.tickerAssetsText === 'string' && s.tickerAssetsText) setAssets(s.tickerAssetsText)
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      alive = false
    }
  }, [])

  // Only the two shop "home" sections carry the marquee —
  // product detail, legal, gateway and admin never show it.
  if (view !== 'shop') return null

  const isKids = zone !== 'creator'

  const items: TickerItem[] = [
    { id: 'kids', badge: '🎨 KIDS ZONE', badgeClass: 'bg-[#FFB347] text-[#4a2800]', text: kids, zone: 'kids' },
    { id: 'creator', badge: '⚡ CREATOR STUDIO', badgeClass: 'bg-[#00F5A0] text-[#00281a]', text: creator, zone: 'creator' },
    { id: 'assets', badge: '🚀 DIGITAL ASSETS', badgeClass: 'bg-[#C084FC] text-[#2a0044]', text: assets, zone: 'kids' },
  ]

  const goZone = (z: Zone) => navigate('shop', { zone: z, category: null })

  return (
    <aside
      className={
        isKids
          ? 'ticker-skin-kids relative z-30 w-full border-y-2 border-[#FFB347]/45 bg-gradient-to-r from-[#FFF6DF] via-[#FFEEC2] to-[#FFF6DF] shadow-[0_4px_18px_rgba(255,179,71,0.25)]'
          : 'ticker-skin-creator relative z-30 w-full border-y border-[rgba(229,184,66,0.18)] bg-[#080B0A]'
      }
    >
      <div
        className="ticker-wrap overflow-hidden"
        style={{
          WebkitMaskImage: 'linear-gradient(90deg, transparent, black 7%, black 93%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, black 7%, black 93%, transparent)',
        }}
      >
        <div ref={trackRef} className="ticker-track items-center">
          <TickerGroup items={items} goZone={goZone} />
          <div aria-hidden="true">
            <TickerGroup items={items} goZone={goZone} hidden />
          </div>
        </div>
      </div>
    </aside>
  )
}
