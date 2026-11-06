'use client'

// ═══════════════════════════════════════════════════════════
// Creator score (B5/B7) — "Neon Build & Deploy", two halves:
//   planCreatorScore — PURE: the whole beat sheet as timed
//                      sound events (no ctx, bun-testable).
//   playCreatorScore — schedules the plan up-front on the audio
//                      clock via audio/engine primitives.
// Gentle: intro events stretch onto the stage 'playing' anchor
// (÷ tempoScale, same as the visuals) and every gain is scaled
// by profile.soundScale (the master chain scales again). All
// voice gains stay ≤ CREATOR_LEVEL so the summed peak honours
// the −3 dBFS intent through the zone's master level + limiter.
// ═══════════════════════════════════════════════════════════

import { BASE_TOTAL_MS, CREATOR_BEATS, CREATOR_LEVEL } from '../config/constants'
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
import { CREATOR_ARP, beatSeconds, creatorWipeWindow, introStretch, mulberry32, planCreatorLayout } from './creator-beats'

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
export function planCreatorScore(totalMs: number, profile: MotionProfile): ScorePlan {
  const total = clampTotal(totalMs)
  const k = total / BASE_TOTAL_MS
  const b = scaleBeats(CREATOR_BEATS, total)
  const intro = introStretch(profile)
  const ss = profile.soundScale
  const rnd = mulberry32(20260217)
  const events: ScoreEvent[] = []
  const add = (t: number, kind: string, params: Record<string, number>): void => {
    events.push({ t, kind, params })
  }
  const ti = (base: number): number => base * k * intro

  // IGNITE — low power-up hum (detuned saws through a rising low-pass)
  // + two soft glitch ticks.
  add(ti(0.02), 'hum', { from: 55, to: 110, dur: 0.42 * k * intro, gain: 0.15 * ss })
  add(ti(0.14), 'glitch', { freq: 1244, dur: 0.03 * k, gain: 0.05 * ss })
  add(ti(0.3), 'glitch', { freq: 932, dur: 0.03 * k, gain: 0.04 * ss })

  // BOOT — digital blips + typing ticks, all INSIDE the boot window (which
  // the gentle tempo shifts later); the tempo-locked sub pulse + offbeat
  // hats start at the stretched boot end so event order never flips.
  const bootAt = b.igniteEnd * intro
  const bootEndEff = bootAt + (b.bootEnd - b.igniteEnd) * k
  for (let i = 0; i < 4; i++) {
    add(bootAt + (0.06 + i * 0.16) * k, 'blip', { freq: 880 + i * 220, dur: 0.045 * k, gain: 0.07 * ss })
  }
  for (let i = 0; i < 6; i++) {
    add(bootAt + (0.14 + i * 0.11) * k, 'tick', { freq: 2300, dur: 0.014 * k, gain: 0.03 * ss })
  }
  const beat = beatSeconds() * k
  for (let t = bootEndEff; t < b.compileEnd - 0.01; t += beat) {
    add(t, 'sub', { freq: 55, dur: 0.22 * k, gain: 0.17 * ss })
  }
  for (let t = bootEndEff + beat / 2; t < b.shipEnd - 0.01; t += beat) {
    add(t, 'hat', { dur: 0.045 * k, gain: 0.05 * ss })
  }

  // BUILD — rising arpeggio + one snap stab per build item (seeded times).
  const arpStep = ((b.buildEnd - bootEndEff) / CREATOR_ARP.length) * k
  CREATOR_ARP.forEach((freq, i) => {
    add(bootEndEff + (i + 0.5) * arpStep, 'arp', { freq, dur: 0.2 * k, gain: 0.09 * ss })
  })
  const layout = planCreatorLayout(40, 1, 14)
  layout.items.forEach((item, i) => {
    add(bootEndEff + item.snap * k, 'snap', { freq: 520 + i * 40, dur: 0.12 * k, gain: 0.16 * ss })
  })

  // COMPILE — riser pitch follows progress; chime on each milestone.
  const span = b.compileEnd - b.buildEnd
  const riseFreq = [260, 420, 640, 920]
  const chimeFreq = [880, 1046.5, 1318.5, 1567.98]
  ;[0.25, 0.5, 0.75, 1].forEach((m, i) => {
    const t = b.buildEnd + span * m
    add(t, 'riser', { from: riseFreq[i], to: riseFreq[i] * 1.5, dur: 0.24 * k, gain: 0.05 * ss })
    add(t, 'chime', { freq: chimeFreq[i], dur: 0.5 * k, gain: 0.13 * ss })
  })

  // SHIP IT — restrained impact at the drop + shimmer + last riser.
  add(b.compileEnd, 'impact', { dur: 0.6 * k, gain: 0.2 * ss })
  add(b.compileEnd + 0.08 * k, 'shimmer', { dur: 0.9 * k, gain: 0.05 * ss })
  add(b.compileEnd + 0.16 * k, 'riser', { from: 300, to: 1200, dur: (b.shipEnd - b.compileEnd - 0.16) * k, gain: 0.05 * ss })

  // WIPE & LAND — fading shimmer, filter sweep out.
  const wipe = creatorWipeWindow(totalMs)
  add(wipe.end - 0.02, 'sweep', { from: 3200, to: 160, dur: 0.9 * k, gain: 0.06 * ss })

  events.sort((x, y) => x.t - y.t)
  return { events }
}

/** Schedule the whole plan up-front on the SHARED context; null = silent. */
export function playCreatorScore(totalMs: number, profile: MotionProfile): ScoreHandle | null {
  const scored = getScoreContext()
  if (!scored) return null
  const { ctx, out } = scored
  // Defensive resume: the click already resumed, but a StrictMode remount
  // can land inside makeScoreStop's suspend window — never run silent.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  const chain = createMasterChain(ctx, CREATOR_LEVEL, profile)
  out.connect(chain.input)
  const plan = planCreatorScore(totalMs, profile)
  const t0 = ctx.currentTime + 0.06
  for (const event of plan.events) renderCreatorEvent(ctx, chain, event, t0)
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
function renderCreatorEvent(ctx: AudioContext, chain: MasterChain, e: ScoreEvent, t0: number): void {
  const at = t0 + e.t
  switch (e.kind) {
    case 'hum':
      tone(ctx, chain, { at, freq: num(e.params.from), glideTo: num(e.params.to), dur: num(e.params.dur), gain: num(e.params.gain), type: 'sawtooth', attack: 0.05, filter: { type: 'lowpass', from: 180, to: 1500, q: 1.2 } })
      tone(ctx, chain, { at, freq: num(e.params.from) * 1.011, glideTo: num(e.params.to) * 1.011, dur: num(e.params.dur), gain: num(e.params.gain) * 0.7, type: 'sawtooth', attack: 0.05, filter: { type: 'lowpass', from: 160, to: 1300, q: 1.2 } })
      break
    case 'glitch':
    case 'blip':
    case 'tick':
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain), type: 'square' })
      break
    case 'sub': {
      const g = num(e.params.gain)
      const dur = num(e.params.dur)
      // sub 40–80 Hz + harmonics so phone speakers reproduce the pulse (B7)
      tone(ctx, chain, { at, freq: num(e.params.freq), dur, gain: g })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 2, dur, gain: g * 0.5 })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 3, dur, gain: g * 0.25 })
      break
    }
    case 'hat':
      noiseVoice(ctx, chain, { at, dur: num(e.params.dur), gain: num(e.params.gain), filter: { type: 'highpass', from: 6500, q: 0.7 } })
      break
    case 'arp':
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain), type: 'sawtooth', filter: { type: 'lowpass', from: 700, to: 2600, q: 1.4 } })
      break
    case 'snap':
      noiseVoice(ctx, chain, { at, dur: num(e.params.dur) * 0.5, gain: num(e.params.gain) * 0.7, filter: { type: 'bandpass', from: 1800, to: 900, q: 1 } })
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain) * 0.8, type: 'square' })
      break
    case 'riser':
      tone(ctx, chain, { at, freq: num(e.params.from), glideTo: num(e.params.to), dur: num(e.params.dur), gain: num(e.params.gain), type: 'sawtooth', filter: { type: 'lowpass', from: 400, to: 3000, q: 1.2 } })
      break
    case 'chime':
      tone(ctx, chain, { at, freq: num(e.params.freq), dur: num(e.params.dur), gain: num(e.params.gain) })
      tone(ctx, chain, { at, freq: num(e.params.freq) * 2, dur: num(e.params.dur) * 0.6, gain: num(e.params.gain) * 0.35 })
      break
    case 'impact': {
      const g = num(e.params.gain)
      const dur = num(e.params.dur)
      tone(ctx, chain, { at, freq: 120, glideTo: 40, dur, gain: g })
      noiseVoice(ctx, chain, { at, dur: dur * 0.6, gain: g * 0.7, filter: { type: 'lowpass', from: 900, to: 200, q: 0.8 } })
      tone(ctx, chain, { at, freq: 1567.98, dur: dur * 0.5, gain: g * 0.25 })
      break
    }
    case 'sweep':
      noiseVoice(ctx, chain, { at, dur: num(e.params.dur), gain: num(e.params.gain), attack: 0.15, filter: { type: 'bandpass', from: num(e.params.from), to: num(e.params.to), q: 0.9 } })
      break
    case 'shimmer':
      ;[1567.98, 2093, 2637].forEach((freq, i) => {
        tone(ctx, chain, { at: at + i * 0.05, freq, dur: num(e.params.dur), gain: num(e.params.gain) * (0.6 - i * 0.12), attack: 0.2 })
      })
      break
    default:
      break
  }
}
