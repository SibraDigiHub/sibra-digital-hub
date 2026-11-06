// ═══════════════════════════════════════════════════════════
// decide-mode (B3) — ONE decision per session, cached at first
// prime: { tier, profile }. FAILS UPWARD: blocked/unknown or a
// thrown detection ⇒ a WORKING tier (T2/full), never a skip.
// T0 only on a real probe failure signal. Reduced motion ⇒
// `gentle` — the SAME storyline, never a skip. There is no
// WebGL in this feature, so the probe is cheap and synchronous.
// ═══════════════════════════════════════════════════════════

import type { MotionProfileName } from '../config/motion-profiles'
import type { Tier } from '../config/tiers'

export interface ZoneEnvironment {
  hardwareConcurrency: number
  deviceMemoryGB: number
  saveData: boolean
  reducedMotion: boolean
  coarsePointer: boolean
  /** True ONLY when the hardware probe itself threw — the one signal that maps to T0. */
  probeFailed: boolean
}

export interface ZoneMode {
  tier: Tier
  profile: MotionProfileName
  reason: string
}

/** Capable defaults — unknown values must fail UPWARD, never down. */
const WORKING_ENV: ZoneEnvironment = {
  hardwareConcurrency: 8,
  deviceMemoryGB: 8,
  saveData: false,
  reducedMotion: false,
  coarsePointer: false,
  probeFailed: false,
}

/** Pure decision — unit-tested. Weak devices get T1; a thrown probe is the ONLY T0. */
export function decideMode(env: ZoneEnvironment): ZoneMode {
  if (env.probeFailed) return { tier: 'T0', profile: 'full', reason: 'probe-failed' }
  const weak = env.saveData || env.deviceMemoryGB <= 2 || env.hardwareConcurrency <= 1
  const tier: Tier = weak ? 'T1' : 'T2'
  if (env.reducedMotion) return { tier, profile: 'gentle', reason: 'prefers-reduced-motion' }
  return { tier, profile: 'full', reason: weak ? 'weak-device' : 'capable-device' }
}

function readInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function readMedia(query: string, fallback: boolean): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback
    return window.matchMedia(query).matches
  } catch {
    return fallback
  }
}

/** Reads the hardware signals; every read is individually guarded so a
 *  single odd engine degrades to capable defaults instead of failing. */
export const defaultProbe = (): ZoneEnvironment => {
  const nav: Navigator | null = typeof navigator !== 'undefined' ? navigator : null
  const conn = (nav as { connection?: { saveData?: boolean } } | null)?.connection
  return {
    hardwareConcurrency: readInt(nav?.hardwareConcurrency, WORKING_ENV.hardwareConcurrency),
    deviceMemoryGB: readInt((nav as { deviceMemory?: number } | null)?.deviceMemory, WORKING_ENV.deviceMemoryGB),
    saveData: conn?.saveData === true,
    reducedMotion: readMedia('(prefers-reduced-motion: reduce)', false),
    coarsePointer: readMedia('(pointer: coarse)', false),
    probeFailed: false,
  }
}

export type EnvProbe = () => ZoneEnvironment

/** Runs the probe; ANY throw inside detection fails upward to a working
 *  environment (T2/full) — the visitor is never skipped and never downgraded
 *  by a blocked probe. T0 comes only from decideMode({ probeFailed: true }). */
export function detectEnvironment(probe: EnvProbe = defaultProbe): ZoneEnvironment {
  try {
    return probe()
  } catch {
    return { ...WORKING_ENV }
  }
}

/** ONE production-safe console line per session (B3). */
export function logMode(mode: ZoneMode): void {
  console.info(`zone-transition: tier=${mode.tier} profile=${mode.profile} reason=${mode.reason}`)
}

/** Debug tier override: ?tdebug=0|1|2 → T0/T1/T2. Never active in production. */
export function debugTierOverride(search?: string): Tier | null {
  if (process.env.NODE_ENV === 'production') return null
  try {
    const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '')
    const q = new URLSearchParams(raw).get('tdebug')
    if (q === '0' || q === '1' || q === '2') return `T${q}` as Tier
  } catch {
    /* debug helper only — ignore */
  }
  return null
}
