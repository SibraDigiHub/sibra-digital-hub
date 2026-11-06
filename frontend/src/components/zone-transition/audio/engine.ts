'use client'

// ═══════════════════════════════════════════════════════════
// audio/engine (B7) — shared WebAudio helpers for both zone
// scores. Every function takes its ctx as a parameter so bun
// tests can use fakes; the REAL context is always the app's
// ONE sharedAudioContext() from lib/sound-fx (never a second
// context — an idle context heats phones). Any audio error is
// contained: sound must never break the run.
// ═══════════════════════════════════════════════════════════

import { useAppStore } from '@/store/app-store'
import { sharedAudioContext } from '@/lib/sound-fx'
import { AUDIO_FADE_MS, MAX_LIVE_NODES, REVERB_SECONDS, REVERB_SEND } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'

/**
 * The score's context + unity output bus. Returns null when soundOn is
 * false or the browser has no AudioContext. DOES NOT resume — the caller
 * resumes inside the click gesture (resumeScoreContext).
 */
export function getScoreContext(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined') return null
  if (!useAppStore.getState().soundOn) return null
  const ctx = sharedAudioContext()
  if (!ctx) return null
  // out: connect the score's voices here, then wire out → chain.input.
  // Disconnecting it on dispose mutes the whole score instantly.
  return { ctx, out: ctx.createGain() }
}

/** Resume the SHARED context — must run inside the click gesture. soundOn-guarded. */
export function resumeScoreContext(): void {
  if (typeof window === 'undefined') return
  if (!useAppStore.getState().soundOn) return
  const ctx = sharedAudioContext()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

export interface MasterChain {
  /** Voices connect here. */
  input: GainNode
  master: GainNode
  compressor: DynamicsCompressorNode
  /** Wet bus → generated reverb → master. */
  reverbSend: GainNode
  /** Live-node guard: bounded set, oldest released first (≤ MAX_LIVE_NODES). */
  scheduleNode(node: AudioScheduledSourceNode): void
  releaseNode(node: AudioScheduledSourceNode): void
  liveCount(): number
  dispose(): void
}

/**
 * input → master → compressor → destination, with a generated
 * impulse-response reverb (REVERB_SECONDS) wired reverbSend → Convolver →
 * master. Master gain = level × profile.soundScale so `gentle` is quieter
 * without touching the score code.
 */
export function createMasterChain(ctx: BaseAudioContext, level: number, profile: MotionProfile): MasterChain {
  const input = ctx.createGain()
  const master = ctx.createGain()
  const compressor = ctx.createDynamicsCompressor()
  const reverbSend = ctx.createGain()
  const convolver = ctx.createConvolver()

  master.gain.value = level * profile.soundScale
  reverbSend.gain.value = REVERB_SEND
  convolver.buffer = impulseResponse(ctx, REVERB_SECONDS, 2.4)
  input.connect(master)
  input.connect(reverbSend)
  reverbSend.connect(convolver)
  convolver.connect(master)
  master.connect(compressor)
  compressor.connect(ctx.destination)

  const live = new Set<AudioScheduledSourceNode>()
  let disposed = false
  activeScoreChains++

  const releaseNode = (node: AudioScheduledSourceNode) => {
    live.delete(node)
    try {
      node.stop()
    } catch {
      /* already stopped — never let audio break the run */
    }
  }
  const scheduleNode = (node: AudioScheduledSourceNode) => {
    if (disposed) return
    live.add(node)
    node.onended = () => {
      live.delete(node)
    }
    while (live.size > MAX_LIVE_NODES) {
      const oldest = live.values().next()
      if (oldest.done) break
      releaseNode(oldest.value)
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    activeScoreChains = Math.max(0, activeScoreChains - 1)
    for (const node of [...live]) releaseNode(node)
    live.clear()
    for (const node of [input, master, compressor, reverbSend, convolver]) {
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
  }

  return { input, master, compressor, reverbSend, scheduleNode, releaseNode, liveCount: () => live.size, dispose }
}

/**
 * Live score chains — makeScoreStop only suspends the SHARED context once
 * the last chain is gone. A StrictMode dev remount that rebuilds its score
 * inside the suspend window must never be silenced (B6/B7).
 */
let activeScoreChains = 0

// Noise/impulse buffers are generated once per ctx + seconds (B7).
const noiseCache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>()

/** White-noise buffer, cached per ctx + seconds. */
export function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  let perCtx = noiseCache.get(ctx)
  if (!perCtx) {
    perCtx = new Map()
    noiseCache.set(ctx, perCtx)
  }
  const cached = perCtx.get(seconds)
  if (cached) return cached
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  perCtx.set(seconds, buffer)
  return buffer
}

/** Generated stereo impulse response (exponential decay) for the reverb send. */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buffer
}

/** Tiny haptic tick — silently a no-op where vibrate() is missing (Safari/iOS). */
export function haptic(pattern: number | number[]): void {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* unsupported — visuals carry the beat */
  }
}

export interface ScoreHandle {
  /** Ramp the master gain to 0 (default AUDIO_FADE_MS) — skip/finish fade. */
  stop(fadeMs?: number): void
  /** Disconnect + release everything the chain owns. */
  dispose(): void
}

/**
 * The score stopper: master gain → 0 over fadeMs, then (once) suspend the
 * SHARED context when the score is quiet — an idle running context heats
 * phones (B6). Safe unconditionally: any later playFx() call resumes the
 * shared context on demand (lib/sound-fx getCtx resumes when suspended).
 */
export function makeScoreStop(ctx: AudioContext, master: GainNode): (fadeMs?: number) => void {
  let suspendScheduled = false
  return (fadeMs: number = AUDIO_FADE_MS) => {
    const now = ctx.currentTime
    try {
      const g = master.gain
      g.cancelScheduledValues(now)
      g.setValueAtTime(Math.max(g.value, 0.0001), now)
      g.exponentialRampToValueAtTime(0.0001, now + Math.max(fadeMs, 1) / 1000)
    } catch {
      /* never let audio break the run */
    }
    if (!suspendScheduled) {
      suspendScheduled = true
      setTimeout(() => {
        if (activeScoreChains > 0) return // another score is live (StrictMode remount)
        try {
          void ctx.suspend()
        } catch {
          /* context may already be closed */
        }
      }, fadeMs + 50)
    }
  }
}

// ── Score voice primitives (B7) ────────────────────────────
// Small scheduling helpers used by the zone scores: each call
// schedules a complete voice (osc/noise → env → optional filter →
// chain.input) on the audio clock up front. Gains/frequencies are
// clamped away from zero so exponential ramps stay legal; every
// source registers with the chain's live-node guard.

export interface ToneOpts {
  /** Absolute ctx-time seconds the voice starts at. */
  at: number
  freq: number
  /** Seconds — the envelope decays to silence by at + dur. */
  dur: number
  type?: OscillatorType
  /** Peak voice gain, clamped into (0, 1]. */
  gain?: number
  /** Attack seconds (default 0.004). */
  attack?: number
  /** Optional exponential pitch-glide target (Hz). */
  glideTo?: number
  /** Optional biquad sweep from → to across the voice's life. */
  filter?: { type: BiquadFilterType; from: number; to?: number; q?: number }
}

export function tone(ctx: BaseAudioContext, chain: MasterChain, o: ToneOpts): void {
  const t = Math.max(o.at, ctx.currentTime)
  const dur = Math.max(0.02, o.dur)
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(Math.max(1, o.freq), t)
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), t + dur)
  const peak = Math.min(1, Math.max(0.0001, o.gain ?? 0.2))
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.002, o.attack ?? 0.004))
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(env)
  let head: AudioNode = env
  if (o.filter) {
    const f = ctx.createBiquadFilter()
    f.type = o.filter.type
    f.Q.value = o.filter.q ?? 0.8
    f.frequency.setValueAtTime(Math.max(10, o.filter.from), t)
    if (o.filter.to) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filter.to), t + dur)
    env.connect(f)
    head = f
  }
  head.connect(chain.input)
  chain.scheduleNode(osc)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

export interface NoiseOpts {
  at: number
  dur: number
  gain?: number
  attack?: number
  filter: { type: BiquadFilterType; from: number; to?: number; q?: number }
}

/** Filtered white-noise burst — one cached 1 s buffer per ctx, looped. */
export function noiseVoice(ctx: BaseAudioContext, chain: MasterChain, o: NoiseOpts): void {
  const t = Math.max(o.at, ctx.currentTime)
  const dur = Math.max(0.02, o.dur)
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 1)
  src.loop = true
  const env = ctx.createGain()
  const peak = Math.min(1, Math.max(0.0001, o.gain ?? 0.12))
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.002, o.attack ?? 0.003))
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  const f = ctx.createBiquadFilter()
  f.type = o.filter.type
  f.Q.value = o.filter.q ?? 0.9
  f.frequency.setValueAtTime(Math.max(10, o.filter.from), t)
  if (o.filter.to) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filter.to), t + dur)
  src.connect(env)
  env.connect(f)
  f.connect(chain.input)
  chain.scheduleNode(src)
  src.start(t)
  src.stop(t + dur + 0.05)
}
