'use client'

// ═══════════════════════════════════════════════════════════
// ZoneStage — the overlay shell for ONE zone-transition run
// (z-[80] stacking, proven by the previous transition overlay):
// hosts the choreography content layer + the wipe + its own
// Skip button at z-[80], owns the phase machine, the stage
// timeline, the watchdog, visibility sync, Back handling and
// the scroll-safety guarantee net. ONE cleanup on EVERY exit
// path (done, Skip, Back, watchdog, error, unmount).
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, type JSX } from 'react'
import dynamic from 'next/dynamic'
import gsap from 'gsap'
import { useAppStore } from '@/store/app-store'
import { sharedAudioContext } from '@/lib/sound-fx'
import {
  AUDIO_FADE_MS,
  CREATOR_BEATS,
  KIDS_BEATS,
  SKIP_FAST_MS,
  WATCHDOG_EXTRA_MS,
  ZONE_ANNOUNCEMENT,
  type ChoreoProps,
  type Zone,
} from '../config/constants'
import { MOTION_PROFILES, type MotionProfileName } from '../config/motion-profiles'
import type { Tier } from '../config/tiers'
import type { ZoneTransitionRunData } from '../core/run-store'
import { createZoneMachine, type ZoneMachine, type ZonePhase } from '../core/machine'
import { buildZoneStageTimeline, clampTotal, scaleBeats } from '../core/timeline'
import { createLifecycle, type Lifecycle } from '../core/lifecycle'
import { htmlBodyGuardProps, snapshotStyles, stylesDiffer, type StyleSnapshot } from '../core/scroll-safety'
import { zoneSkipRef } from '../core/skip-registry'
import type { ScoreHandle } from '../audio/engine'
import Wipe from './Wipe'
import ReducedCpuStage from '../fallback/ReducedCpuStage'

// Real choreographies (zone-anim-2) — each its own lazy chunk
// (one next/dynamic per zone, ssr:false, prefetched at idle/hover).
const KidsGiftBox = dynamic(() => import('../kids/KidsGiftBox'), { ssr: false })
const CreatorBuild = dynamic(() => import('../creator/CreatorBuild'), { ssr: false })

export interface ZoneStageProps {
  zone: Zone
  tier: Tier
  profile: MotionProfileName
  totalMs: number
  heroRect: ZoneTransitionRunData['heroRect']
  onEnterZone: (zone: Zone) => void
  onDone: () => void
}

const NOOP = () => undefined

export default function ZoneStage(props: ZoneStageProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLParagraphElement>(null)
  const wipeRef = useRef<HTMLDivElement | null>(null)
  const scoreRef = useRef<ScoreHandle | null>(null)
  const choreoTlRef = useRef<gsap.core.Timeline | null>(null)
  const machineRef = useRef<ZoneMachine | null>(null)
  if (machineRef.current == null) {
    machineRef.current = createZoneMachine()
  }
  const enteredRef = useRef(false)
  const clockStartRef = useRef<() => void>(() => undefined)
  const propsRef = useRef(props)
  // Latest-props bridge — written in an effect (refs are not touched during render).
  useEffect(() => {
    propsRef.current = props
  })

  // Bridges stay functional from the choreography's own mount effect
  // (child effects run BEFORE the stage effect below).
  const reportPhase = useCallback((p: ZonePhase) => {
    machineRef.current?.go(p)
  }, [])
  const enterOnce = useCallback(() => {
    if (enteredRef.current) return
    enteredRef.current = true
    propsRef.current.onEnterZone(propsRef.current.zone)
  }, [])
  const registerScore = useCallback((handle: ScoreHandle | null) => {
    scoreRef.current = handle
  }, [])
  const registerTimeline = useCallback((tl: gsap.core.Timeline | null) => {
    choreoTlRef.current = tl
    // The lazy chunk may load long after the stage mounted — the stage
    // clock STARTS HERE so both clocks run in sync from t=0 (B3).
    if (tl) clockStartRef.current()
  }, [])
  const startClock = useCallback(() => {
    clockStartRef.current()
  }, [])

  useEffect(() => {
    const { zone, profile: profileName, totalMs, onDone } = propsRef.current
    const container = containerRef.current
    const machine = machineRef.current
    if (!container || !machine) return
    if (liveRef.current) liveRef.current.textContent = ZONE_ANNOUNCEMENT[zone]
    const profile = MOTION_PROFILES[profileName]
    const total = clampTotal(totalMs)
    const lifecycle: Lifecycle = createLifecycle()
    let finished = false
    let completionTimer = 0
    machine.go('arming')

    // ── scroll-safety: snapshot once; the lifecycle restores on every exit path.
    const guards = snapshotGuards()
    lifecycle.add(() => restoreGuards(guards))

    // ── the authoritative clock: phase machine + hand-off + done ──
    const scaled = scaleBeats(zone === 'kids' ? KIDS_BEATS : CREATOR_BEATS, total)
    const stage = buildZoneStageTimeline({
      totalMs: total,
      profile,
      phaseAnchors: {
        playingAt: scaled[zone === 'kids' ? 'anticipateEnd' : 'igniteEnd'],
        payoffAt: scaled[zone === 'kids' ? 'levelEnd' : 'compileEnd'],
        wipingAt: scaled.wipeStart,
      },
      hooks: {
        onPhase: (p) => {
          machine.go(p)
        },
        onEnterZone: enterOnce,
        onDone: () => finish(),
      },
    })
    lifecycle.add(() => stage.tl.kill())

    // ── the stage clock waits for the choreography (lazy chunk or T0
    //    CSS fallback) so both timelines start together at t=0 ──
    let clockStarted = false
    const startClockNow = () => {
      if (clockStarted || finished) return
      clockStarted = true
      stage.tl.play(0)
    }
    clockStartRef.current = startClockNow
    if (choreoTlRef.current) startClockNow()

    /** Full stop — kills every registered resource; idempotent on every path. */
    const stopFully = () => {
      lifecycle.disposeAll()
      choreoTlRef.current?.kill()
      choreoTlRef.current = null
      scoreRef.current?.dispose()
      scoreRef.current = null
      zoneSkipRef.current = NOOP
      restoreGuards(guards)
    }
    /** ONE deterministic completion path (done + skip): fade the overlay,
     *  then report done exactly once. The tween alone is not trusted —
     *  rAF-starved tabs can stall GSAP forever, so a wall-clock backup
     *  timer reports done even when no frame ever fires. */
    const completeRun = (fadeMs: number) => {
      if (finished) return
      finished = true
      machine.forceDone()
      zoneSkipRef.current = NOOP
      scoreRef.current?.stop(AUDIO_FADE_MS)
      gsap.to(container, { opacity: 0, duration: fadeMs / 1000, ease: 'power1.in', overwrite: true })
      completionTimer = window.setTimeout(() => {
        completionTimer = 0
        stopFully()
        onDone()
      }, fadeMs + 250)
    }
    /** Done: the stage timeline reached total. */
    const finish = () => completeRun(AUDIO_FADE_MS)
    /** Skip/Back fast path: rush every clock into ≈ SKIP_FAST_MS (B3). */
    const skipNow = () => {
      if (finished) return
      enterOnce()
      if (choreoTlRef.current) choreoTlRef.current.timeScale(total / 1000 / (SKIP_FAST_MS / 1000))
      stage.fastForward()
      completeRun(SKIP_FAST_MS)
    }
    zoneSkipRef.current = skipNow

    // ── watchdog: total + extra forces the fast path, never a stuck run ──
    const watchdog = window.setTimeout(() => {
      enterOnce()
      finish()
    }, total + WATCHDOG_EXTRA_MS)
    lifecycle.add(() => window.clearTimeout(watchdog))
    lifecycle.add(() => {
      if (completionTimer) window.clearTimeout(completionTimer)
    })

    // ── visibility sync: pause BOTH clocks + audio on hidden, resume on visible ──
    const onVisibility = () => {
      const ctx = sharedAudioContext()
      if (document.hidden) {
        stage.tl.pause()
        choreoTlRef.current?.pause()
        void ctx?.suspend().catch(() => undefined)
      } else {
        stage.tl.resume()
        choreoTlRef.current?.resume()
        if (ctx && useAppStore.getState().soundOn) void ctx.resume().catch(() => undefined)
      }
    }
    const onKey = (event: Event) => {
      const e = event as KeyboardEvent
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        skipNow()
      }
    }
    lifecycle.add(listen(window, 'popstate', () => skipNow()))
    lifecycle.add(listen(window, 'hashchange', () => skipNow()))
    lifecycle.add(listen(window, 'keydown', onKey))
    lifecycle.add(listen(document, 'visibilitychange', onVisibility))

    return () => {
      // Unmount: stop everything WITHOUT reporting done (StrictMode-safe —
      // the timeline/watchdog report done, never the unmount itself).
      stopFully()
    }
  }, [enterOnce])

  const choreoProps: ChoreoProps = {
    zone: props.zone,
    tier: props.tier,
    profile: props.profile,
    totalMs: props.totalMs,
    heroRect: props.heroRect,
    onPhase: reportPhase,
    onEnterZone: enterOnce,
    hooks: { wipeRef, registerScore, registerTimeline, startClock },
  }
  // ── TIER SWITCH (the ONE ternary zone-anim-2 upgraded):
  //    T0 keeps the CSS-only fallback; T1/T2 play the real
  //    choreography for the zone (separate lazy chunks each).
  const choreography =
    props.tier === 'T0' ? (
      <ReducedCpuStage {...choreoProps} />
    ) : props.zone === 'kids' ? (
      <KidsGiftBox {...choreoProps} />
    ) : (
      <CreatorBuild {...choreoProps} />
    )

  return (
    <div ref={containerRef} data-zone-stage className="fixed inset-0 z-[80] overflow-hidden" style={{ background: 'transparent' }}>
      {/* Live region sits OUTSIDE the aria-hidden decorative layers. */}
      <p ref={liveRef} aria-live="polite" className="sr-only" />
      <div aria-hidden="true" className="absolute inset-0 z-0">
        {choreography}
      </div>
      <Wipe ref={wipeRef} zone={props.zone} flashPeak={MOTION_PROFILES[props.profile].flashPeak} />
      <button
        type="button"
        onClick={() => zoneSkipRef.current()}
        aria-label="Skip animation"
        className="glass absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-6 py-2.5 text-sm font-semibold text-[#F5F8F6] transition-transform hover:scale-105 focus-visible:outline-none"
      >
        Skip →
      </button>
    </div>
  )
}

function listen(target: EventTarget, type: string, handler: (event: Event) => void): () => void {
  target.addEventListener(type, handler)
  return () => target.removeEventListener(type, handler)
}

// ── scroll-safety (B3): the run NEVER locks scroll — snapshot html/body
//    guard props at mount and restore them at cleanup if anything differs.
interface GuardEntry {
  el: HTMLElement
  snap: StyleSnapshot
}

function snapshotGuards(): GuardEntry[] {
  const snapOf = (el: HTMLElement) => snapshotStyles({ getComputedStyle: () => window.getComputedStyle(el) }, htmlBodyGuardProps)
  return [
    { el: document.documentElement, snap: snapOf(document.documentElement) },
    { el: document.body, snap: snapOf(document.body) },
  ]
}

function restoreGuards(guards: GuardEntry[]): void {
  for (const g of guards) {
    const now = snapshotStyles({ getComputedStyle: () => window.getComputedStyle(g.el) }, htmlBodyGuardProps)
    if (!stylesDiffer(g.snap, now)) continue
    for (const prop of htmlBodyGuardProps) g.el.style.setProperty(prop, g.snap[prop])
  }
}
