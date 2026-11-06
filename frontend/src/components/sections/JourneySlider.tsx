'use client'

// ═══════════════════════════════════════════════════════════
// §11.3.1 — "A Journey Through Learning & Creation"
// Infinite RTL 3D showcase slider. 12 category cards (6 kids
// + 6 creator) rendered twice for a seamless CSS marquee loop.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { playFx } from '@/lib/sound-fx'
import { useMarqueeFallback } from '@/hooks/useMarqueeFallback'
import { hydrateCategories, useZoneCategories } from '@/lib/categories'
import type { Zone } from '@/types/marketplace'

/** category slug → /images/products/<cover>.png */
const COVER_MAP: Record<string, string> = {
  'coloring-books': 'kids-coloring',
  'activity-puzzles': 'kids-puzzle',
  'story-ebooks': 'kids-story',
  'abcd-number-tracing': 'kids-tracing',
  'diy-flashcards-crafts': 'kids-flashcards',
  'parents-guides': 'kids-guide',
  'canva-templates': 'creator-canva',
  'ai-prompts': 'creator-prompts',
  'motion-assets': 'creator-motion',
  'scripts-automations': 'creator-scripts',
  'website-ui-kits': 'creator-ui',
  'ats-resumes': 'creator-resume',
}

interface JourneyCard {
  zone: Zone
  slug: string
  label: string
  emoji: string
  blurb: string
  cover: string
}

/** Reveal-on-scroll for the section header (progressive enhancement) */
function useHeaderReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const els = Array.from(root.querySelectorAll<HTMLElement>('.reveal'))
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('revealed'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).classList.add('revealed')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.25 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return ref
}

export default function JourneySlider() {
  const headerRef = useHeaderReveal<HTMLElement>()
  const trackRef = useRef<HTMLDivElement | null>(null)
  // Self-healing marquee: keeps the showcase gliding even on
  // devices that suppress CSS animations (reduced-motion).
  useMarqueeFallback(trackRef, 55)
  const lastPop = useRef(0)

  // T10: live admin-managed categories — new categories appear on
  // the journey automatically (unknown slugs get the generic cover).
  useEffect(() => {
    void hydrateCategories()
  }, [])
  const kidsCats = useZoneCategories('kids')
  const creatorCats = useZoneCategories('creator')
  const CARDS = useMemo<JourneyCard[]>(
    () => [
      ...kidsCats.map((c) => ({
        zone: 'kids' as Zone,
        slug: c.slug,
        label: c.label,
        emoji: c.emoji,
        blurb: c.blurb,
        cover: COVER_MAP[c.slug] ?? 'kids-hero',
      })),
      ...creatorCats.map((c) => ({
        zone: 'creator' as Zone,
        slug: c.slug,
        label: c.label,
        emoji: c.emoji,
        blurb: c.blurb,
        cover: COVER_MAP[c.slug] ?? 'creator-hero',
      })),
    ],
    [kidsCats, creatorCats],
  )

  /** Throttled (300ms) pop sound on any card hover-in */
  const handleCardEnter = useCallback(() => {
    const now = Date.now()
    if (now - lastPop.current > 300) {
      lastPop.current = now
      playFx('pop')
    }
  }, [])

  const handleCardClick = useCallback((zone: Zone, slug: string) => {
    useAppStore.getState().navigate('shop', { zone, category: slug })
  }, [])

  // `copy` + zone + slug + index: keys stay unique within each
  // duplicated marquee set even if the admin category registry ever
  // returns two categories with the same slug (kids and creator
  // lists are concatenated into one CARDS array).
  const renderSet = (copy: 'main' | 'ghost') => (
    <div className="flex shrink-0 gap-6 pr-6" aria-hidden={copy === 'ghost' || undefined}>
      {CARDS.map((card, i) => (
        <button
          key={`${copy}-${card.zone}-${card.slug}-${i}`}
          type="button"
          tabIndex={copy === 'ghost' ? -1 : 0}
          onClick={() => handleCardClick(card.zone, card.slug)}
          onMouseEnter={handleCardEnter}
          onFocus={handleCardEnter}
          aria-label={`Browse ${card.label} in the ${card.zone === 'kids' ? 'Kids' : 'Creator'} zone`}
          className={`journey-item group w-56 shrink-0 overflow-hidden rounded-3xl text-left transition-shadow duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E5B842] md:w-64 ${
            card.zone === 'kids'
              ? 'bg-[#FFF8E7] shadow-[0_10px_30px_rgba(255,136,0,0.18)] hover:shadow-[0_18px_44px_rgba(255,136,0,0.32)]'
              : 'border border-[#00F0FF]/35 bg-[#0D0D0D] shadow-[0_10px_30px_rgba(0,240,255,0.10)] hover:border-[#00F0FF]/70 hover:shadow-[0_18px_44px_rgba(0,240,255,0.22)]'
          }`}
        >
          <span className="block aspect-[4/3] overflow-hidden">
            <img
              src={`/images/products/${card.cover}.png`}
              alt={`${card.label} — printable cover preview`}
              width={640}
              height={480}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            />
          </span>
          <span
            className={`block p-4 ${
              card.zone === 'kids'
                ? 'bg-gradient-to-b from-[#FFF8E7] to-[#FFF2CC] text-[#4a3b2a]'
                : 'bg-[#0D0D0D] text-[#E8F6F2]'
            }`}
          >
            <span
              className={`flex items-center gap-2 text-sm font-bold md:text-base ${
                card.zone === 'kids' ? 'font-baloo' : 'font-jetbrains'
              }`}
            >
              <span aria-hidden="true">{card.emoji}</span>
              <span className="line-clamp-1">{card.label}</span>
            </span>
            <span
              className={`mt-1.5 block text-xs ${
                card.zone === 'kids' ? 'text-[#6b4e26]' : 'text-[#6FA7A0]'
              }`}
            >
              {card.blurb}
            </span>
            <span
              className="mono-tag mt-3 inline-block"
              style={
                card.zone === 'kids'
                  ? {
                      color: '#8c6a1e',
                      borderColor: 'rgba(229, 184, 66, 0.5)',
                      background: 'rgba(229, 184, 66, 0.1)',
                    }
                  : undefined
              }
            >
              Explore →
            </span>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <section
      ref={headerRef}
      aria-labelledby="journey-heading"
      className="relative py-16 md:py-24"
    >
      {/* ── Section header ── */}
      <div className="reveal mx-auto max-w-3xl px-4 text-center">
        <p className="sec-eyebrow font-jetbrains text-xs font-semibold tracking-[0.3em] text-[#E5B842]">
          ── TAKE THE TOUR ──
        </p>
        <h2
          id="journey-heading"
          className="sec-heading chameleon-sweep font-playfair mt-4 text-3xl leading-tight font-semibold text-foreground md:text-5xl"
        >
          A <span className="holo-text">Journey</span> Through Learning
          <br className="hidden md:block" /> &amp; Creation
        </h2>
        <p className="shop-sub mt-4 text-sm text-muted-foreground md:text-base">
          Twelve treasure chests across two worlds — glide through the shelf
          and tap any cover to open its zone.
        </p>
      </div>

      {/* ── Infinite RTL marquee (hover pauses, CSS handles 3D tilt) ── */}
      <div className="relative mt-10 md:mt-14">
        <div className="journey-wrap w-full overflow-hidden">
          <div ref={trackRef} className="journey-track" style={{ gap: 0 }}>
            {renderSet('main')}
            {renderSet('ghost')}
          </div>
        </div>
        {/* Edge fades so cards dissolve into the zone backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[var(--edge-fade)] to-transparent sm:w-20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--edge-fade)] to-transparent sm:w-20"
        />
      </div>
    </section>
  )
}
