'use client'

// ═══════════════════════════════════════════════════════════
// Run store — tiny zustand store INSIDE the kit holding the
// active run. Self-contained on purpose (the gateway hook writes
// it, the page-shell host hook reads it): the main agent can
// later move the field into app-store without touching any
// other wiring. `scenePaused` stays global in app-store and is
// used through its existing API only.
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand'
import type { Zone } from '../config/constants'
import type { MotionProfileName } from '../config/motion-profiles'
import type { Tier } from '../config/tiers'

export interface ZoneTransitionRunData {
  zone: Zone
  tier: Tier
  profile: MotionProfileName
  totalMs: number
  heroRect: { x: number; y: number; width: number; height: number } | null
}

interface ZoneRunState {
  run: ZoneTransitionRunData | null
  setRun: (run: ZoneTransitionRunData | null) => void
}

export const useZoneRunStore = create<ZoneRunState>((set) => ({
  run: null,
  setRun: (run) => set({ run }),
}))
