// ═══════════════════════════════════════════════════════════
// Motion profiles (B3) — reduced motion maps to `gentle`,
// NEVER to a skip: same storyline, same duration, softer
// execution. One object consumed by stage, choreographies and
// audio; no scattered `if (reduce)` anywhere else.
// ═══════════════════════════════════════════════════════════

export type MotionProfileName = 'full' | 'gentle'

export interface MotionProfile {
  name: MotionProfileName
  /** Peak opacity of the wipe's inner flash — photosensitivity cap (≤3
   *  flashes/s is respected by the choreographies' single soft pulse). */
  flashPeak: number
  /** Screen bounce/shake allowed at all (gentle = never). */
  screenShake: boolean
  /** Multiplier on particle/DOM counts (gentle halves them). */
  particleScale: number
  /** Intra-beat tempo multiplier (0.9 = beats land ~11% later); the master
   *  anchors (enterZone at total − WIPE_LEAD_MS, done at total) stay pinned
   *  so the run duration never changes with the profile. */
  tempoScale: number
  /** Global audio gain multiplier. */
  soundScale: number
  /** Haptic ticks allowed (both profiles keep them — tiny + guarded). */
  haptics: boolean
}

export const MOTION_PROFILES: Record<MotionProfileName, MotionProfile> = {
  full: { name: 'full', flashPeak: 0.55, screenShake: true, particleScale: 1, tempoScale: 1, soundScale: 1, haptics: true },
  gentle: { name: 'gentle', flashPeak: 0.3, screenShake: false, particleScale: 0.5, tempoScale: 0.9, soundScale: 0.7, haptics: true },
}
