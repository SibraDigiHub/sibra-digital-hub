'use client'

// ═══════════════════════════════════════════════════════════
// Creator timeline builders (B5) — pure GSAP section pushers
// that CreatorBuild assembles into ONE master timeline. Every
// tween animates transform/opacity only (+ the stage wipe and
// its capped flash); the ring counter/typing text are direct
// DOM writes from onUpdate (no React state per frame). Text/
// rain payload objects are prebuilt so animation callbacks
// allocate nothing.
// ═══════════════════════════════════════════════════════════

import gsap from 'gsap'
import { CREATOR_COLORS, WIPE_FLASH_SELECTOR } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'
import { PARTICLE_KINDS, type ParticleEmitOpts } from '../stage/Particles2D'
import { haptic } from '../audio/engine'
import { type CreatorItemSpot, type CreatorLayout } from './creator-beats'
import { GATEWAY_CONTENT } from '@/lib/gateway-content'

export interface CreatorStage {
  tl: gsap.core.Timeline
  profile: MotionProfile
  /** Scaled beat sheet (seconds at the run's total). */
  b: Record<string, number>
  /** totalMs / BASE_TOTAL_MS — scales base-authored offsets. */
  k: number
  /** 1 / profile.tempoScale — stretches the intro onto the stage anchor. */
  tempo: number
  /** Ignite instant (scaled + tempo-stretched). */
  bootAt: number
  /** Boot-segment end (gentle shifts it later; the build grid starts here). */
  bootEndEff: number
  vw: number
  vh: number
  layout: CreatorLayout
  root: HTMLDivElement
  wipe: HTMLDivElement | null
  /** Particles2D emit api from CodeRain2D (may be null pre-ready). */
  rain: { current: { emit: (kind: number, count: number, opts?: ParticleEmitOpts) => void } | null }
  onEnterZone: () => void
}

const WILL = { willChange: 'transform, opacity' }

/**
 * The Kids side powers down and slides away within ~0.8 s (B3) —
 * gateway panel, seam, monogram, mobile shell + header.
 */
export function pushGatewayExit(tl: gsap.core.Timeline, k: number): void {
  // document-level query: these elements live OUTSIDE the choreography
  // root, and gsap.context would scope selector text to the root.
  const els = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-gw-panel="left"], [data-gw-shell="kids"], [data-gw-seam], [data-gw-mono], [data-gw-mheader]',
    ),
  )
  if (els.length === 0) return
  tl.set(els, WILL, 0)
  tl.to(els, {
    x: () => -window.innerWidth * 0.22,
    opacity: 0,
    duration: Math.min(0.8, 0.8 * k),
    ease: 'power2.in',
    onComplete: () => gsap.set(els, { clearProps: 'willChange' }),
  }, 0)
}

/** IGNITE: obsidian base, neon-edge panel over the chosen card, safe glitch-in. */
export function pushIgnite(tl: gsap.core.Timeline, s: CreatorStage): void {
  const base = s.root.querySelector<HTMLDivElement>('[data-c-base]')
  const panel = s.root.querySelector<HTMLDivElement>('[data-c-ignite]')
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-gw-card="creator"]'))
  if (base) tl.to(base, { opacity: 0.96, duration: 0.4 * s.k * s.tempo, ease: 'power1.out' }, 0)
  if (panel) {
    tl.fromTo(panel, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.22 * s.k * s.tempo, ease: 'back.out(1.6)' }, 0.08 * s.k)
    // one brief, low-contrast glitch burst (2 soft blinks, no strobing)
    for (const side of [1, 2]) {
      const slice = s.root.querySelector<HTMLElement>(`[data-c-glitch="${side}"]`)
      if (!slice) continue
      tl.to(slice, {
        keyframes: { x: [0, side === 1 ? -6 : 6, side === 1 ? 4 : -4, 0], opacity: [0, 0.55, 0.35, 0] },
        duration: 0.28 * s.k * s.tempo,
        ease: 'none',
      }, 0.06 * s.k)
    }
  }
  if (cards.length > 0) {
    tl.set(cards, WILL, 0.05 * s.k)
    tl.to(cards, { opacity: 0, duration: 0.2 * s.k * s.tempo, onComplete: () => gsap.set(cards, { clearProps: 'willChange' }) }, 0.24 * s.k)
  }
}

/** BOOT: scanline sweep, grid rush, title glitch-types in (direct DOM writes). */
export function pushBoot(tl: gsap.core.Timeline, s: CreatorStage): void {
  const scan = s.root.querySelector<HTMLDivElement>('[data-c-scan]')
  const gridWrap = s.root.querySelector<HTMLDivElement>('[data-c-grid]')
  const gridInner = s.root.querySelector<HTMLDivElement>('[data-c-grid-inner]')
  if (gridWrap) tl.to(gridWrap, { opacity: 0.9, duration: 0.3 * s.k * s.tempo }, s.bootAt - 0.05 * s.k)
  if (gridInner) {
    tl.fromTo(gridInner, { z: -560 }, { z: -40, duration: (s.b.bootEnd - s.b.igniteEnd) * s.k * s.tempo, ease: 'power2.in' }, s.bootAt)
    tl.to(gridInner, { z: 60, duration: (s.b.compileEnd - s.bootEndEff) * s.k, ease: 'none' }, s.bootEndEff)
  }
  if (scan) {
    tl.fromTo(scan, { y: -24, opacity: 0 }, { opacity: 0.55, duration: 0.1 * s.k }, s.bootAt)
    tl.to(scan, { y: () => s.vh * 1.05, duration: (s.b.bootEnd - s.b.igniteEnd) * s.k * s.tempo, ease: 'none' }, s.bootAt)
    tl.to(scan, { opacity: 0, duration: 0.15 * s.k }, s.bootEndEff - 0.1 * s.k)
  }
  const title = s.root.querySelector<HTMLElement>('[data-c-title]')
  const cursor = s.root.querySelector<HTMLElement>('[data-c-cursor]')
  if (title) {
    const text = title.dataset.cFull ?? GATEWAY_CONTENT.creator.title
    const state = { n: 0, shown: -1 }
    tl.fromTo(title, { opacity: 0.35 }, { opacity: 1, duration: 0.2 * s.k * s.tempo, ease: 'steps(2)' }, s.bootAt)
    tl.to(state, {
      n: text.length,
      duration: (s.bootEndEff - s.bootAt) * 0.6,
      ease: 'none',
      onUpdate: () => {
        const n = Math.round(state.n)
        if (n !== state.shown) {
          state.shown = n
          title.textContent = text.slice(0, n)
        }
      },
    }, s.bootAt + 0.05 * s.k)
  }
  if (cursor) {
    tl.to(cursor, { opacity: 1, duration: 0.01 * s.k }, s.bootAt)
    tl.to(cursor, { opacity: 0, duration: 0.3 * s.k, repeat: 5, yoyo: true, ease: 'steps(1)' }, s.bootAt + 0.02 * s.k)
    tl.to(cursor, { opacity: 0, duration: 0.05 * s.k }, s.bootEndEff)
  }
  if (s.profile.haptics) tl.call(() => haptic(14), undefined, s.bootEndEff)
}

/** BUILD: holo items snap into place one by one + code rain streams behind. */
export function pushBuild(tl: gsap.core.Timeline, s: CreatorStage): void {
  const els = Array.from(s.root.querySelectorAll<HTMLElement>('[data-c-item]'))
  els.forEach((el, i) => {
    const item = s.layout.items[i]
    if (!item) return
    pushSnap(tl, s, el, item)
  })
  const prompt = s.root.querySelector<HTMLElement>('[data-c-type]')
  if (prompt) {
    const text = '> deploy --prod'
    const state = { n: 0, shown: -1 }
    tl.to(state, {
      n: text.length,
      duration: (s.b.buildEnd - s.bootEndEff) * 0.4 * s.k,
      ease: 'none',
      onUpdate: () => {
        const n = Math.round(state.n)
        if (n !== state.shown) {
          state.shown = n
          prompt.textContent = text.slice(0, n)
        }
      },
    }, s.bootEndEff + 0.3 * s.k)
  }
  pushCodeRain(tl, s)
}

function pushSnap(tl: gsap.core.Timeline, s: CreatorStage, el: HTMLElement, item: CreatorItemSpot): void {
  const t = s.bootEndEff + item.snap * s.k
  const x = (item.fx - 0.5) * s.vw
  const y = (item.fy - 0.45) * s.vh
  tl.fromTo(el,
    { x, y: y + 70, z: -420, scale: item.scale * 0.7, opacity: 0, rotationY: item.rot + 14 },
    { x, y, z: item.z, scale: item.scale, opacity: 1, rotationY: item.rot, duration: 0.42 * s.k, ease: 'back.out(1.7)' },
    t)
  const pulse = el.querySelector<HTMLElement>('[data-c-pulse]')
  if (pulse) tl.fromTo(pulse, { opacity: 0 }, { opacity: 0.9, duration: 0.08 * s.k, yoyo: true, repeat: 1, ease: 'power1.out' }, t + 0.3 * s.k)
  if (s.profile.haptics) tl.call(() => haptic(8), undefined, t)
}

/** Code rain: prebuilt per-column payloads → one timeline call per step. */
function pushCodeRain(tl: gsap.core.Timeline, s: CreatorStage): void {
  const columns = Math.max(1, s.layout.rainColumns)
  const ps = s.profile.particleScale
  const count = Math.max(1, Math.round(1.6 * ps))
  const colOpts: ParticleEmitOpts[] = Array.from({ length: columns }, (_, c) => ({
    x: (c + 0.5) / columns,
    y: -0.04,
    spreadX: 0.012,
    spreadY: 0,
    speed: 0.5,
    ttl: 1.25,
    size: 7,
    hue: c % 3 === 0 ? 152 : c % 3 === 1 ? 130 : 187,
    hueSpread: 6,
    alpha: 0.5,
  }))
  const step = s.layout.rainStep * s.k
  for (let t = s.bootEndEff; t < s.b.compileEnd - 0.05; t += step) {
    tl.call(() => {
      const api = s.rain.current
      if (!api) return
      for (const opts of colOpts) api.emit(PARTICLE_KINDS.raindrop, count, opts)
    }, undefined, t)
  }
}

/** COMPILE: ring fills 0→100 with counting number; milestones pulse; ✓ pops. */
export function pushCompile(tl: gsap.core.Timeline, s: CreatorStage): void {
  const wrap = s.root.querySelector<HTMLElement>('[data-c-ringwrap]')
  const arc = s.root.querySelector<SVGCircleElement>('[data-c-arc]')
  const numEl = s.root.querySelector<HTMLElement>('[data-c-num]')
  const CIRC = 2 * Math.PI * 54
  if (wrap) tl.to(wrap, { opacity: 1, duration: 0.25 * s.k }, s.b.buildEnd - 0.1 * s.k)
  if (arc || numEl) {
    const state = { p: 0, shown: -1 }
    tl.to(state, {
      p: 100,
      duration: (s.b.compileEnd - s.b.buildEnd) * s.k,
      ease: 'power1.inOut',
      onUpdate: () => {
        if (arc) arc.style.strokeDashoffset = String(CIRC * (1 - state.p / 100))
        const n = Math.round(state.p)
        if (numEl && n !== state.shown) {
          state.shown = n
          numEl.textContent = `${n}%`
        }
      },
    }, s.b.buildEnd)
  }
  const segments = Array.from(s.root.querySelectorAll<HTMLElement>('[data-c-seg]'))
  const span = (s.b.compileEnd - s.b.buildEnd) * s.k
  segments.forEach((seg, i) => {
    tl.set(seg, { opacity: 1 }, s.b.buildEnd + ((i + 1) / Math.max(1, segments.length)) * span)
  })
  if (wrap) {
    for (const m of [0.25, 0.5, 0.75]) {
      tl.to(wrap, { scale: 1.08, duration: 0.09 * s.k, yoyo: true, repeat: 1, ease: 'power1.inOut' }, s.b.buildEnd + span * m)
    }
  }
  const check = s.root.querySelector<HTMLElement>('[data-c-check]')
  if (check) {
    tl.fromTo(check, { scale: 0, opacity: 0 }, { scale: 1.25, opacity: 1, duration: 0.22 * s.k, ease: 'back.out(2.4)' }, s.b.compileEnd)
    tl.to(check, { scale: 1, duration: 0.12 * s.k }, s.b.compileEnd + 0.22 * s.k)
  }
  if (s.profile.haptics) {
    for (const m of [0.25, 0.5, 0.75, 1]) tl.call(() => haptic(10), undefined, s.b.buildEnd + span * m)
  }
}

/** SHIP IT + WIPE: shockwave, beams, arcs, sparks → obsidian wipe → land. */
export function pushShipWipe(tl: gsap.core.Timeline, s: CreatorStage, wipeWindow: { start: number; end: number }): void {
  const shock = s.root.querySelector<HTMLElement>('[data-c-shock]')
  if (shock) tl.fromTo(shock, { scale: 0.25, opacity: 0.9 }, { scale: 3.4, opacity: 0, duration: 0.7 * s.k, ease: 'power1.out' }, s.b.compileEnd)
  const beams = Array.from(s.root.querySelectorAll<HTMLElement>('[data-c-beam]'))
  beams.forEach((beam, i) => {
    tl.fromTo(beam, { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 0.75, duration: 0.22 * s.k, ease: 'power2.out' }, s.b.compileEnd + i * 0.06 * s.k)
    tl.to(beam, { opacity: 0, duration: 0.3 * s.k }, s.b.compileEnd + (0.32 + i * 0.06) * s.k)
  })
  const arcs = Array.from(s.root.querySelectorAll<SVGPathElement>('[data-c-arc-line]'))
  arcs.forEach((arc, i) => {
    // exactly 2 soft blinks per arc — well inside the ≤ 3 flashes/s cap
    tl.fromTo(arc, { opacity: 0 }, { opacity: 0.65, duration: 0.07 * s.k, yoyo: true, repeat: 1, ease: 'steps(1)' }, s.b.compileEnd + (0.08 + i * 0.16) * s.k)
  })
  const ps = s.profile.particleScale
  const bursts: Array<[number, number]> = [[PARTICLE_KINDS.spark, 187], [PARTICLE_KINDS.spark, 327], [PARTICLE_KINDS.confetti, 45]]
  bursts.forEach(([kind, hue], i) => {
    const opts: ParticleEmitOpts = { x: 0.5, y: 0.45, spreadX: 0.2, spreadY: 0.16, speed: 0.7, ttl: 1.4, size: 8, hue, hueSpread: 10 }
    tl.call(() => s.rain.current?.emit(kind, Math.round(60 * ps), opts), undefined, s.b.compileEnd + i * 0.03 * s.k)
  })
  const cta = s.root.querySelector<HTMLElement>('[data-c-cta]')
  if (cta) tl.fromTo(cta, { opacity: 0, scale: 0.8, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: 0.3 * s.k, ease: 'back.out(1.8)' }, s.b.compileEnd + 0.15 * s.k)
  if (s.profile.haptics) tl.call(() => haptic(32), undefined, s.b.compileEnd)
  const gridWrap = s.root.querySelector<HTMLDivElement>('[data-c-grid]')
  if (gridWrap) tl.to(gridWrap, { opacity: 0.3, duration: 0.5 * s.k }, s.b.compileEnd)
  if (s.wipe) {
    tl.fromTo(s.wipe, { opacity: 0 }, { opacity: 1, duration: wipeWindow.end - wipeWindow.start, ease: 'power1.in' }, wipeWindow.start)
  }
  tl.call(() => s.onEnterZone(), undefined, wipeWindow.end)
  const tail: ParticleEmitOpts = { x: 0.5, y: 0.14, spreadX: 0.4, spreadY: 0.08, speed: 0.25, ttl: 2.2, size: 6, hue: 165, hueSpread: 40 }
  tl.call(() => s.rain.current?.emit(PARTICLE_KINDS.spark, Math.round(24 * ps), tail), undefined, wipeWindow.end)
}
