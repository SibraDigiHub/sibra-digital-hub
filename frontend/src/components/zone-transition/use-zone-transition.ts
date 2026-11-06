'use client'

// ═══════════════════════════════════════════════════════════
// useZoneTransition (B3) — the ONE hook the gateway calls:
// decides {tier, profile} once per session at first prime
// (cached, one console line), starts a run on click (audio
// resumed INSIDE the click gesture, SceneCanvas paused, hero
// card measured for the FLIP), and idle-prefetches both
// choreography chunks so the click is instant. The run lives in
// the kit's run-store so the overlay — hosted by the page shell
// — survives the gateway unmount at zone entry.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { CREATOR_TOTAL_MS, KIDS_TOTAL_MS, PRODUCT_ART, type Zone } from './config/constants'
import type { ZoneMode } from './core/decide-mode'
import { decideMode, debugTierOverride, detectEnvironment, logMode } from './core/decide-mode'
import { clampTotal } from './core/timeline'
import { zoneSkipRef } from './core/skip-registry'
import { useZoneRunStore, type ZoneTransitionRunData } from './core/run-store'
import { resumeScoreContext } from './audio/engine'

export type { Zone } from './config/constants'
export type { ZoneTransitionRunData } from './core/run-store'

export interface ZoneTransitionControls {
  active: boolean
  /** Cached decide-mode + prefetch that zone's chunk + its 3 product images. */
  prime: (z?: Zone) => void
  start: (zone: Zone, hero: HTMLElement | null) => void
  skip: () => void
}

function totalFor(zone: Zone): number {
  return clampTotal(zone === 'kids' ? KIDS_TOTAL_MS : CREATOR_TOTAL_MS)
}

function measureHero(hero: HTMLElement | null): ZoneTransitionRunData['heroRect'] {
  if (!hero || typeof window === 'undefined') return null
  try {
    const r = hero.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  } catch {
    return null
  }
}

function prefetchImages(zone: Zone): void {
  if (typeof window === 'undefined') return
  for (const src of PRODUCT_ART[zone]) {
    try {
      const img = new Image()
      img.src = src
    } catch {
      /* image warm-up is best-effort — the gateway already cached them */
    }
  }
}

export function useZoneTransition(): ZoneTransitionControls {
  const modeRef = useRef<ZoneMode | null>(null)
  const setScenePaused = useAppStore((s) => s.setScenePaused)

  /** Decide once per session; every call warms the requested zone's chunk + art. */
  const prime = useCallback((z?: Zone): ZoneMode => {
    if (!modeRef.current) {
      const mode = decideMode(detectEnvironment())
      const override = debugTierOverride()
      const final = override ? { ...mode, tier: override } : mode
      logMode(final)
      modeRef.current = final
    }
    if (z) {
      prefetchImages(z)
      // Warm the hovered zone's choreography chunk (both on idle, see below).
      // Static literals only — Turbopack cannot resolve computed specifiers.
      if (z === 'kids') {
        void import('./kids/KidsGiftBox')
      } else {
        void import('./creator/CreatorBuild')
      }
    }
    return modeRef.current
  }, [])

  const start = useCallback(
    (zone: Zone, hero: HTMLElement | null) => {
      const runStore = useZoneRunStore.getState()
      if (runStore.run) return // a run is active — double click does nothing
      // Mode is normally cached from first hover; a click without hover
      // decides now (the probe is synchronous + fail-upward).
      const mode = prime()
      if (useZoneRunStore.getState().run) return // re-check after prime's prefetch work
      resumeScoreContext() // inside the click gesture (B7)
      setScenePaused(true)
      runStore.setRun({ zone, tier: mode.tier, profile: mode.profile, totalMs: totalFor(zone), heroRect: measureHero(hero) })
    },
    [prime, setScenePaused],
  )

  const skip = useCallback(() => zoneSkipRef.current(), [])

  // Idle prefetch after the gateway paints — keeps the click instant and
  // both choreography chunks out of the shared bundle (B2).
  useEffect(() => {
    let cancelled = false
    const warm = () => {
      if (cancelled) return
      void import('./kids/KidsGiftBox')
      void import('./creator/CreatorBuild')
    }
    if ('requestIdleCallback' in window) {
      const id = (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(warm)
      return () => {
        cancelled = true
        ;(window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id)
      }
    }
    const t = setTimeout(warm, 1200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [])

  return { active: useZoneRunStore((s) => Boolean(s.run)), prime, start, skip }
}

/**
 * Host-side wiring — used by the page shell, which renders ZoneStage ABOVE
 * the view switch so it survives the gateway unmount at zone entry.
 */
export function useZoneTransitionHost(): {
  run: ZoneTransitionRunData | null
  onEnterZone: (zone: Zone) => void
  onDone: () => void
} {
  const run = useZoneRunStore((s) => s.run)

  const onEnterZone = useCallback((zone: Zone) => {
    useAppStore.getState().enterZone(zone)
  }, [])

  const onDone = useCallback(() => {
    useZoneRunStore.getState().setRun(null)
    useAppStore.getState().setScenePaused(false)
    // Focus lands on the revealed home page heading (B3 done).
    requestAnimationFrame(() => {
      const h = document.querySelector<HTMLElement>('main h1, main h2')
      if (h) {
        h.setAttribute('tabindex', '-1')
        h.focus({ preventScroll: true })
      }
    })
  }, [])

  return { run, onEnterZone, onDone }
}
