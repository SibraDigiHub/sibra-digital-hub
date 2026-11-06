'use client'

// ═══════════════════════════════════════════════════════════
// Kids timeline builders (B4) — pure GSAP section pushers that
// KidsGiftBox assembles into ONE master timeline. Every tween
// animates transform/opacity only (the stage wipe's own opacity
// + its inner flash are the two sanctioned exceptions); items
// are positioned with % anchors + px offsets so mid-sequence
// rotation reflows safely. No timers, no React state here.
// ═══════════════════════════════════════════════════════════

import gsap from 'gsap'
import { WIPE_FLASH_SELECTOR, type Zone } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'
import { PARTICLE_KINDS, type Particles2D } from '../stage/Particles2D'
import { haptic } from '../audio/engine'
import type { KidsItemSpot } from './kids-beats'

export interface KidsStage {
  tl: gsap.core.Timeline
  profile: MotionProfile
  /** Scaled beat sheet (seconds at the run's total). */
  b: Record<string, number>
  /** totalMs / BASE_TOTAL_MS — scales base-authored offsets. */
  k: number
  /** 1 / profile.tempoScale — stretches the intro onto the stage anchor. */
  tempo: number
  /** Pop instant (scaled + tempo-stretched). */
  popAt: number
  fx: number
  fy: number
  vw: number
  vh: number
  particles: Particles2D
  spots: KidsItemSpot[]
  root: HTMLDivElement
  wipe: HTMLDivElement | null
  onEnterZone: () => void
}

const WILL = { willChange: 'transform, opacity' }

/**
 * The OTHER side quietly slides/fades away within ~0.8 s (B3):
 * gateway panel, seam, monogram, mobile shell + header — the
 * gateway's own DOM, animated transform/opacity only.
 */
export function pushGatewayExit(tl: gsap.core.Timeline, zone: Zone, k: number): void {
  const side = zone === 'kids' ? 'right' : 'left'
  const other = zone === 'kids' ? 'creator' : 'kids'
  const dir = zone === 'kids' ? 1 : -1
  // document-level query: these elements live OUTSIDE the choreography
  // root, and gsap.context would scope selector text to the root.
  const els = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-gw-panel="${side}"], [data-gw-shell="${other}"], [data-gw-seam], [data-gw-mono], [data-gw-mheader]`,
    ),
  )
  if (els.length === 0) return
  tl.set(els, WILL, 0)
  tl.to(els, {
    x: () => window.innerWidth * 0.22 * dir,
    opacity: 0,
    duration: Math.min(0.8, 0.8 * k),
    ease: 'power2.in',
    onComplete: () => gsap.set(els, { clearProps: 'willChange' }),
  }, 0)
}

/** The clicked card squashes (0.94 / +4 px) then stretches — the wind-up. */
export function pushCardSquash(tl: gsap.core.Timeline, zone: Zone, k: number, tempo: number, popAt: number): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(`[data-gw-card="${zone}"]`))
  if (cards.length === 0) return
  tl.set(cards, WILL, 0)
  tl.to(cards, { scale: 0.94, y: 4, duration: 0.26 * k * tempo, ease: 'power2.inOut' }, 0)
  tl.to(cards, { scale: 1.05, y: -3, duration: 0.16 * k * tempo, ease: 'power2.out' }, 0.27 * k * tempo)
  tl.to(cards, {
    opacity: 0,
    duration: 0.12 * k * tempo,
    ease: 'power1.out',
    onComplete: () => gsap.set(cards, { clearProps: 'willChange' }),
  }, Math.max(0, popAt - 0.1 * k * tempo))
}

/** ANTICIPATION glow + POP: box crossfade, 3D lid flip, bounce, bursts. */
export function pushPop(tl: gsap.core.Timeline, s: KidsStage): void {
  const q = <T extends HTMLElement>(sel: string): T | null => s.root.querySelector<T>(sel)
  const box = q<HTMLDivElement>('[data-k-box]')
  const lid = q<HTMLDivElement>('[data-k-lid]')
  const body = q<HTMLDivElement>('[data-k-body]')
  const glow = q<HTMLDivElement>('[data-k-glow]')
  if (!box || !lid || !body || !glow) return
  tl.fromTo(glow, { opacity: 0 }, { opacity: 0.85, duration: 0.34 * s.k * s.tempo, ease: 'power1.out' }, 0.04 * s.k)
  // the clicked card becomes the gift box at the pop instant (FLIP crossfade)
  tl.to(box, { opacity: 1, duration: 0.1 * s.k * s.tempo }, s.popAt - 0.12 * s.k * s.tempo)
  tl.fromTo(box, { scale: 0.94 }, { scale: 1.07, duration: 0.16 * s.k * s.tempo, ease: 'back.out(2.4)' }, s.popAt)
  tl.to(box, { scale: 1, duration: 0.2 * s.k * s.tempo, ease: 'power2.out' }, s.popAt + 0.16 * s.k * s.tempo)
  tl.to(lid, { rotationX: -108, duration: 0.5 * s.k * s.tempo, ease: 'back.out(1.3)' }, s.popAt + 0.02 * s.k)
  tl.to(body, { scaleX: 1.09, scaleY: 0.88, duration: 0.09 * s.k * s.tempo, yoyo: true, repeat: 1, ease: 'power1.inOut' }, s.popAt + 0.03 * s.k)
  // tiny screen bounce (never a shake; the gentle profile skips it entirely)
  if (s.profile.screenShake) {
    tl.fromTo(s.root, { y: 0 }, { y: 7, duration: 0.1 * s.k, yoyo: true, repeat: 1, ease: 'power1.inOut' }, s.popAt)
  }
  const ps = s.profile.particleScale
  const starOpts = { x: s.fx, y: s.fy, spreadX: 0.06, spreadY: 0.05, speed: 0.55, ttl: 1.5, size: 9, hue: 46, hueSpread: 16, alpha: 0.95 }
  const cannon = { x: s.fx, y: s.fy, spreadX: 0.05, spreadY: 0.04, speed: 0.85, ttl: 2.2, size: 8, hue: 24, hueSpread: 36 }
  tl.call(() => s.particles.emit(PARTICLE_KINDS.confetti, Math.round(64 * ps), cannon), undefined, s.popAt + 0.02 * s.k)
  tl.call(() => s.particles.emit(PARTICLE_KINDS.star, Math.round(26 * ps), starOpts), undefined, s.popAt + 0.05 * s.k)
  if (s.profile.haptics) tl.call(() => haptic(18), undefined, s.popAt)
}

/** TREASURE RAIN: items fly from the box to seeded targets with squash-landings. */
export function pushTreasureRain(tl: gsap.core.Timeline, s: KidsStage): void {
  const wrap = s.root.querySelector<HTMLDivElement>('[data-k-rainbow-wrap]')
  const bands = Array.from(s.root.querySelectorAll<SVGPathElement>('[data-k-rainbow]'))
  if (wrap) {
    tl.fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: 0.25 * s.k }, s.b.popEnd + 0.08 * s.k)
    tl.to(bands, { strokeDashoffset: 0, duration: (s.b.treasureEnd - s.b.popEnd) * 0.72 * s.k, ease: 'power1.inOut', stagger: 0.07 * s.k }, s.b.popEnd + 0.12 * s.k)
    tl.to(wrap, { opacity: 0.4, duration: 0.6 * s.k }, s.b.treasureEnd)
  }
  const els = Array.from(s.root.querySelectorAll<HTMLElement>('[data-k-fly]'))
  els.forEach((el, i) => {
    const spot = s.spots[i]
    if (!spot) return
    const start = s.b.popEnd + spot.delay * s.k
    const x = (spot.fx - s.fx) * s.vw
    const y = (spot.fy - s.fy) * s.vh
    tl.fromTo(el,
      { x: 0, y: 0, z: -180, scale: 0.15, rotation: spot.rot * 1.8, opacity: 0 },
      { x, y, z: spot.z, scale: spot.scale, rotation: spot.rot, opacity: 1, duration: Math.max(0.3, spot.dur * s.k), ease: 'back.out(1.5)' },
      start)
    if (spot.floats) {
      tl.to(el, { y: y - s.vh * 0.1, rotation: spot.rot + 8, duration: 1.1 * s.k, repeat: 2, yoyo: true, ease: 'sine.inOut' }, start + spot.dur * s.k)
    } else {
      tl.to(el, { scaleX: spot.scale * 1.12, scaleY: spot.scale * 0.85, duration: 0.085 * s.k, yoyo: true, repeat: 1, ease: 'power1.out' }, start + spot.dur * s.k)
    }
  })
  // bubbly sparkle bursts punctuate the rain window (variable rewards)
  const ps = s.profile.particleScale
  for (let n = 0; n < 5; n++) {
    const opts = { x: 0.15 + n * 0.18, y: 0.32 + (n % 2) * 0.24, spreadX: 0.08, spreadY: 0.08, speed: 0.3, ttl: 1.4, size: 7, hue: n % 2 ? 150 : 45, hueSpread: 20, up: true }
    tl.call(() => s.particles.emit(PARTICLE_KINDS.bubble, Math.round(5 * ps), opts), undefined, s.b.popEnd + (0.35 + n * 0.38) * s.k)
  }
}

/** LEVEL-UP: star meter fills, items spiral to centre, balloons rise, cards orbit. */
export function pushLevelUp(tl: gsap.core.Timeline, s: KidsStage): void {
  const levelSpan = (s.b.levelEnd - s.b.treasureEnd) * s.k
  const stars = Array.from(s.root.querySelectorAll<SVGSVGElement>('[data-km-star]'))
  const rings = Array.from(s.root.querySelectorAll<HTMLElement>('[data-km-ring]'))
  stars.forEach((star, i) => {
    const t = s.b.treasureEnd + ((i + 0.7) / 3) * (s.b.levelEnd - s.b.treasureEnd)
    tl.fromTo(star, { scale: 0, opacity: 0, rotation: -45 }, { scale: 1.25, opacity: 1, rotation: 10, duration: 0.28 * s.k, ease: 'back.out(2.3)' }, t)
    tl.to(star, { scale: 1, rotation: 0, duration: 0.14 * s.k }, t + 0.28 * s.k)
    const ring = rings[i]
    if (ring) tl.fromTo(ring, { scale: 0.3, opacity: 0.85 }, { scale: 2.1, opacity: 0, duration: 0.5 * s.k, ease: 'power1.out' }, t)
    if (s.profile.haptics) tl.call(() => haptic(12), undefined, t)
  })
  const els = Array.from(s.root.querySelectorAll<HTMLElement>('[data-k-fly]'))
  els.forEach((el, i) => {
    const spot = s.spots[i]
    if (!spot) return
    if (spot.floats) {
      tl.to(el, { y: (spot.fy - s.fy) * s.vh - s.vh * 0.3, opacity: 0.9, duration: levelSpan, ease: 'sine.in' }, s.b.treasureEnd)
      return
    }
    if (spot.kind === 'card') {
      pushCardOrbit(tl, s, el, spot, levelSpan)
      return
    }
    tl.to(el, {
      x: (0.5 - s.fx) * s.vw * 0.66 + ((i % 5) - 2) * 24,
      y: (0.47 - s.fy) * s.vh * 0.66 + ((i % 3) - 1) * 20,
      z: 60,
      rotation: spot.rot + 30,
      duration: levelSpan * 0.92,
      ease: 'power2.inOut',
    }, s.b.treasureEnd + (i % 6) * 0.03 * s.k)
  })
}

/** Product-card orbit: 16 precomputed keyframe samples of a shrinking circle. */
function pushCardOrbit(tl: gsap.core.Timeline, s: KidsStage, el: HTMLElement, spot: KidsItemSpot, levelSpan: number): void {
  const cx = (0.5 - s.fx) * s.vw
  const cy = (0.47 - s.fy) * s.vh
  const r0 = Math.hypot((spot.fx - 0.5) * s.vw, (spot.fy - 0.47) * s.vh)
  const a0 = Math.atan2((spot.fy - 0.47) * s.vh, (spot.fx - 0.5) * s.vw)
  const N = 16
  const xs: number[] = []
  const ys: number[] = []
  for (let n = 1; n <= N; n++) {
    const a = a0 + (n / N) * 2.4
    const r = r0 * (1 - 0.35 * (n / N))
    xs.push(cx + Math.cos(a) * r)
    ys.push(cy + Math.sin(a) * r)
  }
  tl.to(el, { keyframes: { x: xs, y: ys }, duration: levelSpan, ease: 'none' }, s.b.treasureEnd)
}

/** PAYOFF + WIPE: ta-da flash, mega confetti, then the cream wipe into the zone. */
export function pushPayoffWipe(tl: gsap.core.Timeline, s: KidsStage, wipeWindow: { start: number; end: number }): void {
  const flash = s.wipe?.querySelector<HTMLElement>(WIPE_FLASH_SELECTOR) ?? null
  if (flash) {
    tl.fromTo(flash, { opacity: 0 }, { opacity: s.profile.flashPeak, duration: 0.15 * s.k, ease: 'power1.in' }, s.b.levelEnd)
    tl.to(flash, { opacity: 0, duration: 0.38 * s.k, ease: 'power1.out' }, s.b.levelEnd + 0.15 * s.k)
  }
  const burst = s.root.querySelector<HTMLElement>('[data-k-burst]')
  const cta = s.root.querySelector<HTMLElement>('[data-k-cta]')
  if (burst) {
    tl.fromTo(burst, { scale: 0.2, opacity: 0, rotation: -35 }, { scale: 1.2, opacity: 1, rotation: 0, duration: 0.26 * s.k, ease: 'back.out(1.9)' }, s.b.levelEnd)
    tl.to(burst, { scale: 1.6, opacity: 0, duration: 0.4 * s.k, ease: 'power1.out' }, s.b.levelEnd + 0.26 * s.k)
  }
  if (cta) {
    tl.fromTo(cta, { opacity: 0, scale: 0.8, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: 0.3 * s.k, ease: 'back.out(1.8)' }, s.b.levelEnd + 0.1 * s.k)
  }
  const ps = s.profile.particleScale
  const mega = { x: 0.5, y: 0.38, spreadX: 0.42, spreadY: 0.2, speed: 0.7, ttl: 2.6, size: 9, hue: 30, hueSpread: 50 }
  const shower = { x: 0.5, y: 0.3, spreadX: 0.45, spreadY: 0.18, speed: 0.4, ttl: 2.2, size: 10, hue: 50, hueSpread: 14 }
  tl.call(() => s.particles.emit(PARTICLE_KINDS.confetti, Math.round(150 * ps), mega), undefined, s.b.levelEnd)
  tl.call(() => s.particles.emit(PARTICLE_KINDS.star, Math.round(46 * ps), shower), undefined, s.b.levelEnd + 0.06 * s.k)
  if (s.profile.haptics) tl.call(() => haptic(30), undefined, s.b.levelEnd)
  // the cream wipe rises and is fully opaque exactly at enterZone (stage anchor)
  if (s.wipe) {
    tl.fromTo(s.wipe, { opacity: 0 }, { opacity: 1, duration: wipeWindow.end - wipeWindow.start, ease: 'power1.in' }, wipeWindow.start)
  }
  tl.call(() => s.onEnterZone(), undefined, wipeWindow.end)
  const tail = { x: 0.5, y: 0.12, spreadX: 0.4, spreadY: 0.06, speed: 0.22, ttl: 2.4, size: 7, hue: 40, hueSpread: 30 }
  tl.call(() => s.particles.emit(PARTICLE_KINDS.confetti, Math.round(30 * ps), tail), undefined, wipeWindow.end)
}
