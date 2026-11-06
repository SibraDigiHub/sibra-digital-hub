'use client'

// ═══════════════════════════════════════════════════════════
// Kids score (B4/B7) — "Magic Gift Box Pop", two halves:
//   planKidsScore — PURE: the whole beat sheet as timed sound
//                   events (no ctx, bun-testable).
//   playKidsScore — schedules the plan up-front on the audio
//                   clock via audio/engine primitives.
// Gentle: intro events stretch onto the stage 'playing' anchor
// (÷ tempoScale, same as the visuals) and every gain is scaled
// by profile.soundScale (the master chain scales again). All
// voice gains stay ≤ KIDS_LEVEL so the summed peak honours the
// −6 dBFS intent through the zone's master level + limiter.
// ═══════════════════════════════════════════════════════════

import { BASE_TOTAL_MS, KIDS_BEATS, KIDS_LEVEL } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'
import { clampTotal, scaleBeats } from '../core/timeline'
import {
  createMasterChain,
  getScoreContext,
  makeScoreStop,
  noiseVoice,
  tone,
  type MasterChain,
  type ScoreHandle,
} from '../audio/engine'
import { KIDS_FLYING_ITEMS, KIDS_PENTATONIC, introStretch, kidsWipeWindow, mulberry32, planKidsLayout } from './kids-beats'

export interface ScoreEvent {
  /** Seconds from the run's start. */
  t: number
  kind: string
  params: Record<string, number | string>
}

export interface ScorePlan {
  events: ScoreEvent[]
}

/** Pure beat-sheet → sound-event plan (scaled + tempo-stretched, gains × soundScale). */
export function planKidsScore(totalMs: number, profile: MotionProfile): ScorePlan {
  const total = clampTotal(totalMs)
  const k = total / BASE_TOTAL_MS
  const b = scaleBeats(KIDS_BEATS, total)
  const intro = introStretch(profile)
  const ss = profile.soundScale
  const rnd = mulberry32(20260216)
  const events: ScoreEvent[] = []
  const add = (t: number, kind: string, params: Record<string, number>): void => {
    events.push({ t, kind, params })
  }
  const ti = (base: number): number => base * k * intro

  // ANTICIPATION — soft rising boing (two gentle glides).
  add(ti(0.02), 'boing', { from: 196, to: 392, dur: 0.4 * k * intro, gain: 0.13 * ss })
  add(ti(0.26), 'boing', { from: 262, to: 523, dur: 0.18 * k * intro, gain: 0.09 * ss })

  // POP — cork pop + the FIRST note of the marimba run + sparkle. The run
  // is one continuous ascending walk: pop note = index 0, one further note
  // per item at its landing.
  const popAt = b.anticipateEnd * intro
  add(popAt, 'pop', { dur: 0.16 * k, gain: 0.2 * ss })
  add(popAt + 0.02 * k, 'marimba', { freq: KIDS_PENTATONIC[0], dur: 0.5 * k, gain: 0.19 * ss })
  add(popAt + 0.05 * k, 'sparkle', { dur: 0.55 * k, gain: 0.05 * ss, count: 5 })

  // TREASURE RAIN — one marimba note per item at its landing (run continues).
  const lands = planKidsLayout(40, 1)
    .map((spot) => b.popEnd + (spot.delay + spot.dur * 0.85) * k)
    .sort((x, y) => x - y)
  lands.forEach((land, i) => {
    add(land, 'marimba', { freq: KIDS_PENTATONIC[(i + 1) % KIDS_PENTATONIC.length], dur: 0.42 * k, gain: (0.14 + rnd() * 0.06) * ss })
  })
  for (let i = 0; i < 4; i++) {
    add(b.popEnd + (0.35 + i * 0.55) * k, 'bubble', { from: 280 + i * 90, to: 620 + i * 110, dur: 0.09 * k, gain: 0.07 * ss })
  }
  for (let i = 0; i < 4; i++) {
    add(b.popEnd + (0.7 + i * 0.55) * k, 'sparkle', { dur: 0.4 * k, gain: 0.045 * ss, count: 4 })
  }

  // LEVEL-UP — swelling pad + three rising star chimes.
  add(b.treasureEnd, 'pad', { freq: 130.81, dur: (b.levelEnd - b.treasureEnd) * k, gain: 0.09 * ss })
  const starGap = (b.levelEnd - b.treasureEnd) / 3
  ;[1046.5, 1318.51, 1567.98].forEach((freq, i) => {
    add(b.treasureEnd + (i + 1) * starGap, 'star', { freq, dur: 0.6 * k, gain: 0.17 * ss })
  })

  // PAYOFF — bright major-chord ta-da + sparkle cascade.
  add(b.levelEnd, 'tada', { dur: 0.9 * k, gain: 0.18 * ss })
  for (let i = 0; i < 4; i++) {
    add(b.levelEnd + (0.1 + i * 0.12) * k, 'sparkle', { dur: 0.35 * k, gain: 0.04 * ss, count: 4 })
  }

  // WIPE & LAND — gentle fade-out shimmer.
  const wipe = kidsWipeWindow(totalMs)
  add(wipe.end - 0.05, 'shimmer', { dur: 1.2 * k, gain: 0.06 * ss })

  events.sort((x, y) => x.t - y.t)
  return { events }
}

/** Schedule the whole plan up-front on the SHARED context; null = silent. */
export function playKidsScore(totalMs: number, profile: MotionProfile): ScoreHandle | null {
  const scored = getScoreContext()
  if (!scored) return null
  const { ctx, out } = scored
  // Defensive resume: the click already resumed, but a StrictMode remount
  // can land inside makeScoreStop's suspend window — never run silent.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  const chain = createMasterChain(ctx, KIDS_LEVEL, profile)
  out.connect(chain.input)
  const plan = planKidsScore(totalMs, profile)
  const t0 = ctx.currentTime + 0.06
  for (const event of plan.events) renderKidsEvent(ctx, chain, event, t0)
  const stop = makeScoreStop(ctx, chain.master)
  return {
    stop,
    dispose: () => {
      stop(1)
      out.disconnect()
      chain.dispose()
    },
  }
}

const num = (v: number | string | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Map one planned event onto engine primitives (all scheduled, no timers). */
function renderKidsEvent(ctx: AudioContext, chain: MasterChain, e: ScoreEvent, t0: number): void {
  const at = t0 + e.t
  switch (e.kind) {
    case 'boing':
      tone(ctx, chain, { at, freq: num(e.params.from), glideTo: num(e.params.to), dur: num(e.params.dur), gain: num(e.params.gain), attack: 0.02 })
      break
    case 'pop':
      noiseVoice(ctx, chain, { at, dur: num(e.params.dur), gain: num(e.params.gain) * 0.9, filter: { type: 'bandpass', from: 900, to: 240, q: 1.1 } })
      tone(ctx, chain, { at, freq: 420, glideTo: 90, dur: num(e.params.dur) * 0.9, gain: num(e.params.gain) })
      break
    case 'marimba':
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain), type: 'triangle', attack: 0.003 })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 2.01, dur: num(e.params.dur) * 0.35, gain: num(e.params.gain) * 0.3 })
      break
    case 'bubble':
      tone(ctx, chain, { at, freq: num(e.params.from), glideTo: num(e.params.to), dur: num(e.params.dur), gain: num(e.params.gain) })
      break
    case 'sparkle': {
      const n = Math.max(2, Math.round(num(e.params.count)))
      for (let i = 0; i < n; i++) {
        tone(ctx, chain, { at: at + i * 0.045, freq: 2200 + i * 340 + (i % 2) * 180, dur: num(e.params.dur) * 0.3, gain: num(e.params.gain) })
      }
      break
    }
    case 'star':
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain) })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 1.5, dur: num(e.params.dur) * 0.6, gain: num(e.params.gain) * 0.4 })
      break
    case 'pad':
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain), type: 'triangle', attack: 0.5 })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 1.5, dur: num(e.params.dur), gain: num(e.params.gain) * 0.8, type: 'triangle', attack: 0.6 })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 2, dur: num(e.params.dur) * 0.8, gain: num(e.params.gain) * 0.5, attack: 0.7 })
      break
    case 'tada': {
      const g = num(e.params.gain)
      const dur = num(e.params.dur)
      ;[523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone(ctx, chain, { at, freq, dur, gain: g * (i === 0 || i === 3 ? 1 : 0.75), type: 'triangle', attack: 0.006 })
      })
      noiseVoice(ctx, chain, { at, dur: dur * 0.4, gain: g * 0.4, filter: { type: 'bandpass', from: 3200, to: 5200, q: 0.8 } })
      break
    }
    case 'shimmer':
      ;[1567.98, 2093, 2637].forEach((freq, i) => {
        tone(ctx, chain, { at: at + i * 0.06, freq, dur: num(e.params.dur), gain: num(e.params.gain) * (0.6 - i * 0.12), attack: 0.3 })
      })
      break
    default:
      break
  }
}
