'use client'

// ═══════════════════════════════════════════════════════════
// Web Audio synthesised sound effects (PRD §12) — zero asset
// files. Respects the Sound On/Off toggle in the app store.
// ═══════════════════════════════════════════════════════════

import { useAppStore } from '@/store/app-store'

type FxName = 'pop' | 'flip' | 'whoosh' | 'chime' | 'sparkle' | 'error'

let ctx: AudioContext | null = null

/**
 * The app's ONE long-lived AudioContext (shared by playFx and the
 * zone-transition score — never create a second context, an
 * idle AudioContext keeps the audio thread alive and heats phones).
 * Does NOT resume it: callers decide when (resume must run inside a
 * user gesture; playFx resumes below).
 */
export function sharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

function getCtx(): AudioContext | null {
  const audio = sharedAudioContext()
  if (!audio) return null
  if (audio.state === 'suspended') void audio.resume()
  return audio
}

function tone(
  audio: AudioContext,
  { freq, endFreq, dur, type = 'sine', gain = 0.25, delay = 0 }: { freq: number; endFreq?: number; dur: number; type?: OscillatorType; gain?: number; delay?: number },
) {
  const t0 = audio.currentTime + delay
  const osc = audio.createOscillator()
  const g = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(audio.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noiseBurst(audio: AudioContext, { dur = 0.4, gain = 0.12, delay = 0 }: { dur?: number; gain?: number; delay?: number }) {
  const t0 = audio.currentTime + delay
  const buffer = audio.createBuffer(1, audio.sampleRate * dur, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = audio.createBufferSource()
  src.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(600, t0)
  filter.frequency.exponentialRampToValueAtTime(3200, t0 + dur)
  const g = audio.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter).connect(g).connect(audio.destination)
  src.start(t0)
}

export function playFx(name: FxName) {
  if (typeof window === 'undefined') return
  if (!useAppStore.getState().soundOn) return
  const audio = getCtx()
  if (!audio) return
  const V = 0.22
  switch (name) {
    case 'pop':
      tone(audio, { freq: 520, endFreq: 920, dur: 0.12, type: 'triangle', gain: V })
      break
    case 'flip':
      tone(audio, { freq: 340, endFreq: 720, dur: 0.22, type: 'sine', gain: V * 0.8 })
      break
    case 'whoosh':
      noiseBurst(audio, { dur: 0.5, gain: V * 0.6 })
      break
    case 'chime':
      tone(audio, { freq: 880, dur: 0.35, type: 'sine', gain: V })
      tone(audio, { freq: 1320, dur: 0.45, type: 'sine', gain: V * 0.7, delay: 0.09 })
      tone(audio, { freq: 1760, dur: 0.5, type: 'sine', gain: V * 0.5, delay: 0.18 })
      break
    case 'sparkle':
      for (let i = 0; i < 4; i++) tone(audio, { freq: 1400 + i * 420, dur: 0.14, type: 'sine', gain: V * 0.4, delay: i * 0.055 })
      break
    case 'error':
      tone(audio, { freq: 220, endFreq: 140, dur: 0.3, type: 'sawtooth', gain: V * 0.5 })
      break
  }
}
