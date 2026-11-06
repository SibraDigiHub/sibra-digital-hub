// ═══════════════════════════════════════════════════════════
// Particles2D (B6) — ONE pooled Canvas-2D layer for the whole
// run: typed-array storage, swap-remove pooling, a single
// internal rAF loop with a frame accumulator honouring fpsCap
// (30 phones/weak, 60 desktop — the caller decides), and ZERO
// allocations inside the loop (colour strings come from a
// palette LUT built once). Flat shapes + globalAlpha only — no
// shadows, no blur. Positions are stored as viewport FRACTIONS
// so resize() (rotation mid-sequence) needs no per-particle work.
// ═══════════════════════════════════════════════════════════

export const PARTICLE_KINDS = { confetti: 0, star: 1, spark: 2, streak: 3, raindrop: 4, bubble: 5 } as const

export interface ParticleEmitOpts {
  /** Origin as viewport fractions 0..1 (default: random). */
  x?: number
  y?: number
  /** Origin jitter in fractions. */
  spreadX?: number
  spreadY?: number
  /** Speed magnitude in fractions/second. */
  speed?: number
  /** Lifetime seconds. */
  ttl?: number
  /** Base size px. */
  size?: number
  /** HSL hue + spread (palette LUT is bucketed every 15°). */
  hue?: number
  hueSpread?: number
  /** Base opacity 0..1. */
  alpha?: number
  /** Rise instead of fall (balloons, bubbles). */
  up?: boolean
}

export interface Particles2DOpts {
  /** Hard cap — must come from TIER_BUDGETS[tier].particles. */
  max: number
  /** Frame cap in fps (30 phones/weak, 60 desktop — caller decides). */
  fpsCap: number
  /** Overrides the automatic rule: min(devicePixelRatio, 2) desktop, 1 phones. */
  dpr?: number
}

const HUE_STEP = 15
const HUE_BUCKETS = 360 / HUE_STEP
const LIGHT_STEPS = [55, 68, 82]

export class Particles2D {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly max: number
  private readonly fpsCap: number
  private readonly dpr: number
  /** Colour LUT: [hueBucket][lightIndex] → prebuilt hsl() string (no loop allocs). */
  private readonly palette: string[][]

  private readonly fx: Float32Array
  private readonly fy: Float32Array
  private readonly vx: Float32Array
  private readonly vy: Float32Array
  private readonly life: Float32Array
  private readonly ttl: Float32Array
  private readonly size: Float32Array
  private readonly rot: Float32Array
  private readonly vr: Float32Array
  private readonly hue: Float32Array
  private readonly alpha: Float32Array
  private readonly kind: Uint8Array

  private count = 0
  private w = 1
  private h = 1
  private running = false
  private rafId = 0
  private last = 0
  private accumulator = 0

  constructor(canvas: HTMLCanvasElement, opts: Particles2DOpts) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.max = Math.max(1, Math.floor(opts.max))
    this.fpsCap = opts.fpsCap > 0 ? opts.fpsCap : 60
    const phone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(max-width: 1024px)').matches || navigator.maxTouchPoints > 1)
    this.dpr = opts.dpr ?? (phone ? 1 : Math.min(window.devicePixelRatio || 1, 2))

    this.palette = []
    for (let h = 0; h < HUE_BUCKETS; h++) {
      const row: string[] = []
      for (const l of LIGHT_STEPS) row.push(`hsl(${h * HUE_STEP} 90% ${l}%)`)
      this.palette.push(row)
    }

    this.fx = new Float32Array(this.max)
    this.fy = new Float32Array(this.max)
    this.vx = new Float32Array(this.max)
    this.vy = new Float32Array(this.max)
    this.life = new Float32Array(this.max)
    this.ttl = new Float32Array(this.max)
    this.size = new Float32Array(this.max)
    this.rot = new Float32Array(this.max)
    this.vr = new Float32Array(this.max)
    this.hue = new Float32Array(this.max)
    this.alpha = new Float32Array(this.max)
    this.kind = new Uint8Array(this.max)

    this.resize()
  }

  get alive(): number {
    return this.count
  }

  /** Pool up to `max`; extra emits beyond the cap are dropped silently. */
  emit(kind: number, count: number, opts: ParticleEmitOpts = {}): void {
    if (!this.ctx) return
    for (let n = 0; n < count; n++) {
      if (this.count >= this.max) return
      const i = this.count++
      const sx = opts.spreadX ?? 0.08
      const sy = opts.spreadY ?? 0.08
      const speed = opts.speed ?? 0.15
      const ttl = opts.ttl ?? 2.5
      const size = opts.size ?? 8
      const angle = Math.random() * Math.PI * 2
      const mag = speed * (0.5 + Math.random() * 0.8)
      this.kind[i] = kind
      this.fx[i] = Math.min(1, Math.max(0, (opts.x ?? Math.random()) + (Math.random() * 2 - 1) * sx))
      this.fy[i] = Math.min(1, Math.max(0, (opts.y ?? Math.random()) + (Math.random() * 2 - 1) * sy))
      this.vx[i] = Math.cos(angle) * mag
      // Confetti/streaks/rain fall, bubbles/balloons rise (up flips gravity).
      this.vy[i] = Math.sin(angle) * mag * 0.6 + (opts.up ? -Math.abs(mag) : Math.abs(mag) * 0.8)
      this.life[i] = 0
      this.ttl[i] = ttl * (0.7 + Math.random() * 0.6)
      this.size[i] = size * (0.6 + Math.random() * 0.8)
      this.rot[i] = Math.random() * Math.PI * 2
      this.vr[i] = (Math.random() * 2 - 1) * 3
      this.hue[i] = (opts.hue ?? 30) + (Math.random() * 2 - 1) * (opts.hueSpread ?? 20)
      this.alpha[i] = opts.alpha ?? 0.9
    }
  }

  /** Recompute the backing store; particles reposition from stored fractions. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.w = Math.max(1, Math.round(rect.width))
    this.h = Math.max(1, Math.round(rect.height))
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  resume(): void {
    if (this.running || !this.ctx) return
    this.running = true
    this.last = performance.now()
    this.accumulator = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  /** Stop the loop and release the 2D context (B6 zero leftovers). */
  dispose(): void {
    this.pause()
    this.count = 0
    this.canvas.width = 0
    this.canvas.height = 0
  }

  private frame = (now: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.frame)
    const stepMs = 1000 / this.fpsCap
    this.accumulator += Math.min(now - this.last, 100)
    this.last = now
    let drew = false
    while (this.accumulator >= stepMs) {
      this.step(stepMs / 1000)
      this.accumulator -= stepMs
      drew = true
    }
    if (drew) this.draw()
  }

  /** Fixed-step physics — swap-remove dead particles, no allocations. */
  private step(dt: number): void {
    let i = 0
    while (i < this.count) {
      this.life[i] += dt
      if (this.life[i] >= this.ttl[i]) {
        this.kill(i)
        continue
      }
      const k = this.kind[i]
      // Per-kind feel: sparks decelerate, rain falls straight, bubbles rise.
      if (k === PARTICLE_KINDS.spark) {
        this.vx[i] *= 0.94
        this.vy[i] *= 0.94
      } else if (k === PARTICLE_KINDS.raindrop) {
        this.vx[i] = 0
      } else if (k === PARTICLE_KINDS.bubble) {
        this.vy[i] = -Math.abs(this.vy[i]) * 0.995
      }
      this.fx[i] += this.vx[i] * dt
      this.fy[i] += this.vy[i] * dt
      this.rot[i] += this.vr[i] * dt
      i++
    }
  }

  private kill(index: number): void {
    const last = this.count - 1
    if (index !== last) {
      this.fx[index] = this.fx[last]
      this.fy[index] = this.fy[last]
      this.vx[index] = this.vx[last]
      this.vy[index] = this.vy[last]
      this.life[index] = this.life[last]
      this.ttl[index] = this.ttl[last]
      this.size[index] = this.size[last]
      this.rot[index] = this.rot[last]
      this.vr[index] = this.vr[last]
      this.hue[index] = this.hue[last]
      this.alpha[index] = this.alpha[last]
      this.kind[index] = this.kind[last]
    }
    this.count = last
  }

  /** Flat shapes only — globalAlpha + palette LUT, zero per-frame allocations. */
  private draw(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    for (let i = 0; i < this.count; i++) {
      const age = this.life[i] / this.ttl[i]
      const fade = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85
      ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha[i] * fade))
      const hueIdx = Math.min(HUE_BUCKETS - 1, Math.max(0, Math.round(this.hue[i] / HUE_STEP)))
      const lightIdx = i % LIGHT_STEPS.length
      ctx.fillStyle = this.palette[hueIdx][lightIdx]
      ctx.strokeStyle = ctx.fillStyle
      const x = this.fx[i] * this.w
      const y = this.fy[i] * this.h
      const s = this.size[i]
      const k = this.kind[i]
      if (k === PARTICLE_KINDS.confetti) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(this.rot[i])
        ctx.fillRect(-s / 2, -s / 4, s, s / 2)
        ctx.restore()
      } else if (k === PARTICLE_KINDS.star) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(this.rot[i])
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.lineTo(s / 3, 0)
        ctx.lineTo(0, s)
        ctx.lineTo(-s / 3, 0)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      } else if (k === PARTICLE_KINDS.streak) {
        ctx.lineWidth = Math.max(1, s / 4)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - this.vx[i] * this.w * 0.06, y - this.vy[i] * this.h * 0.06)
        ctx.stroke()
      } else if (k === PARTICLE_KINDS.raindrop) {
        ctx.lineWidth = Math.max(1, s / 6)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + s * 2.2)
        ctx.stroke()
      } else if (k === PARTICLE_KINDS.bubble) {
        ctx.lineWidth = Math.max(1, s / 5)
        ctx.beginPath()
        ctx.arc(x, y, s, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(x, y, s / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }
}
