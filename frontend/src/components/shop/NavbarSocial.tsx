'use client'

// ═══════════════════════════════════════════════════════════
// T-V Feature A — navbar Social Media control (owner request: one
// icon, one action). Clicking it takes you straight to the
// CURRENT ZONE's "Our Social Media Family" section:
//   • already on the zone's shop page → smooth-scrolls down;
//   • anywhere else (product page, other view) → navigates to
//     that zone's shop first, then glides to the section.
// Hidden entirely when the zone has no channels (the section
// renders nothing) and on utility views (admin/watch/gateway).
// The kids "Ask a grown-up" check still guards the actual
// social exits — those live on the section's cards.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef } from 'react'
import { Share2 } from 'lucide-react'
import type { Zone } from '@/types/marketplace'
import { useChannels } from '@/lib/use-channels'
import { useAppStore } from '@/store/app-store'

/** Smooth-scroll to the section, with bounded re-corrections — lazy
 *  sections/images settling after the view swap can shift the page while
 *  the glide is in flight, leaving the first scroll short of the target. */
function glideToSocialFamily(): void {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth'
  const el = document.getElementById('social-family')
  if (!el) return
  el.scrollIntoView({ behavior, block: 'start' })
  let corrections = 0
  const settle = window.setInterval(() => {
    // A detached element reports rect 0 → onTarget → loop ends itself.
    const top = el.getBoundingClientRect().top
    if ((top >= -48 && top <= 160) || corrections >= 4) {
      window.clearInterval(settle)
      return
    }
    corrections += 1
    el.scrollIntoView({ behavior, block: 'start' })
  }, 500)
  window.setTimeout(() => window.clearInterval(settle), 3000)
}

/** Smooth-scroll to the zone's social section once it exists in the DOM. */
function scrollToSocialFamily(): void {
  const jump = glideToSocialFamily
  // The section mounts only after the channels fetch lands (and the shop
  // view swap resets scroll) — poll briefly instead of failing on the
  // very first frame.
  const started = Date.now()
  const poll = window.setInterval(() => {
    if (document.getElementById('social-family')) {
      window.clearInterval(poll)
      jump()
    } else if (Date.now() - started > 6000) {
      window.clearInterval(poll)
    }
  }, 120)
}

export default function NavbarSocial({ zone, view }: { zone: Zone | null; view: string }) {
  // No Social entry on the gateway (navbar itself is hidden there)
  // and none on admin/admin-reset — those are utility views.
  const active = view !== 'admin' && view !== 'admin-reset' && view !== 'watch'
  const effectiveZone: Zone = zone === 'creator' ? 'creator' : 'kids'
  const channels = useChannels(active ? effectiveZone : null)
  const navigate = useAppStore((s) => s.navigate)
  const navTimer = useRef<number | null>(null)

  // Clear pending navigation if the control unmounts mid-jump.
  useEffect(
    () => () => {
      if (navTimer.current !== null) window.clearTimeout(navTimer.current)
    },
    [],
  )

  const onClick = useCallback(() => {
    if (view === 'shop') {
      scrollToSocialFamily()
      return
    }
    navigate('shop', { zone: effectiveZone, category: null })
    // Wait out the view swap (scroll reset + shop entry animation)
    // before gliding down to the section.
    navTimer.current = window.setTimeout(scrollToSocialFamily, 450)
  }, [view, effectiveZone, navigate])

  if (!active || channels.length === 0) return null

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Our Social Media Family — jump to the section"
      title="Our Social Media Family"
      // `nav-social` gets the dark-on-light kids-zone override from
      // globals.css (same tone as .nav-link) — the near-white base color
      // vanished on the white kids glass; hover stays YouTube red.
      className="nav-social grid size-11 place-items-center rounded-full text-[#F5F8F6]/85 transition-colors hover:text-[#FF0000] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B842]"
    >
      <Share2 className="size-5" aria-hidden="true" />
    </button>
  )
}
