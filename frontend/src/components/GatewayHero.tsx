'use client'

// ═══════════════════════════════════════════════════════════
// 3D Split-Screen Hero Gateway (PRD §7.1 / §7.3 / §7.4)
// Desktop: diagonal clip-path seam (damped ±6° following the
// mouse) + hover-expand 58/42 + tilt glass cards + whoosh
// slide-open transition. Mobile: stacked swipe-up cards.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, ChevronUp, Lock } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import type { Zone } from '@/types/marketplace'
import { GATEWAY_CONTENT } from '@/lib/gateway-content'
import { useZoneTransition } from './zone-transition'

const EASE: [number, number, number, number] = [0.76, 0, 0.24, 1]
const LEFT_CLIP =
  'polygon(0% 0%, calc(var(--seam-c, 50%) - var(--seam-dx, 0%)) 0%, calc(var(--seam-c, 50%) + var(--seam-dx, 0%)) 100%, 0% 100%)'
const RIGHT_CLIP =
  'polygon(calc(var(--seam-c, 50%) - var(--seam-dx, 0%)) 0%, 100% 0%, 100% 100%, calc(var(--seam-c, 50%) + var(--seam-dx, 0%)) 100%)'

// Public gateway "Admin" button visibility:
//   • dev  → visible (current behaviour, unchanged);
//   • prod → HIDDEN by default; set NEXT_PUBLIC_SHOW_ADMIN=true to show it.
// The console itself is NOT gated by this — #/admin keeps working either
// way (the button is just a convenience link, never a security control).
const SHOW_ADMIN_BUTTON =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_SHOW_ADMIN === 'true'

// Zone card content lives in lib/gateway-content.ts (shared with the
// zone-transition choreographies so the product art stays single-source).
const CONTENT = GATEWAY_CONTENT

/* ── ScatterText — letter-level dopamine heading ────────────
   Letters assemble from scattered offsets on mount (spring +
   stagger), scatter apart when their zone is being entered,
   and each letter lifts with a bright glow flash on hover.
   Deterministic pseudo-random offsets (no hydration mismatch).
   Runs on EVERY device (owner parity rule — desktop OSes that
   report reduced-motion must look like phones). */
function seededRand(i: number, salt: number) {
  const x = Math.sin(i * 997.13 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function lerpColor(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

function ScatterText({
  text,
  scattering,
  from,
  to,
  hoverGlow,
  variant,
}: {
  text: string
  scattering: boolean
  from: string
  to: string
  hoverGlow: string
  variant: 'kids' | 'creator'
}) {
  const n = Math.max(text.length - 1, 1)
  // Group letters into words (inline-block + nowrap) so lines only
  // break BETWEEN words — never mid-word. Global letter index is
  // precomputed (no render-phase mutation).
  const wordData: { word: string; start: number }[] = []
  text.split(' ').reduce((pos, word) => {
    wordData.push({ word, start: pos })
    return pos + word.length + 1
  }, 0)
  return (
    <span aria-hidden="true" className="inline-block">
      {wordData.map(({ word, start }, w) => (
        <span key={w}>
          {w > 0 && ' '}
          <span className="inline-block whitespace-nowrap">
            {word.split('').map((ch, i) => {
              const gi = start + i
              return (
                <motion.span
                  key={i}
                  className={`chameleon-letter inline-block cursor-default ${variant === 'creator' ? 'cham-creator' : ''}`}
                  style={{
                    color: lerpColor(from, to, gi / n),
                    animationDelay: `${-((n - gi) / n) * 3.2}s`,
                  }}
                  initial={{
                    opacity: 0,
                    x: (seededRand(gi, 1) - 0.5) * 130,
                    y: (seededRand(gi, 2) - 0.5) * 100,
                    rotate: (seededRand(gi, 3) - 0.5) * 80,
                    scale: 0.4,
                  }}
                  animate={
                    scattering
                      ? {
                          opacity: 0,
                          x: (seededRand(gi, 4) - 0.5) * 460,
                          y: (seededRand(gi, 5) - 0.5) * 320,
                          rotate: (seededRand(gi, 6) - 0.5) * 260,
                          scale: 0.3,
                        }
                      : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }
                  }
                  transition={{ type: 'spring', stiffness: 320, damping: 22, delay: scattering ? gi * 0.012 : 0.12 + gi * 0.032 }}
                  whileHover={{
                    y: -10,
                    scale: 1.3,
                    rotate: gi % 2 ? 5 : -5,
                    color: hoverGlow,
                    filter: `drop-shadow(0 0 10px ${hoverGlow})`,
                    transition: { type: 'spring', stiffness: 480, damping: 12 },
                  }}
                >
                  {ch}
                </motion.span>
              )
            })}
          </span>
        </span>
      ))}
    </span>
  )
}

/* ── Glass card with 3D tilt + specular glare ─────────────── */
function SideCard({
  side,
  leaving,
  onEnter,
  mobile = false,
}: {
  side: Zone
  leaving: Zone | null
  onEnter: (z: Zone) => void
  mobile?: boolean
}) {
  const c = CONTENT[side]
  const isKids = side === 'kids'
  const innerRef = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)

  const onTilt = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    if (innerRef.current)
      innerRef.current.style.transform = `rotateY(${(px * 14).toFixed(2)}deg) rotateX(${(-py * 14).toFixed(2)}deg)`
    glareRef.current?.style.setProperty('--glare-x', `${((px + 0.5) * 100).toFixed(1)}%`)
    glareRef.current?.style.setProperty('--glare-y', `${((py + 0.5) * 100).toFixed(1)}%`)
  }
  const untilt = () => {
    if (innerRef.current) innerRef.current.style.transform = ''
  }

  return (
    <button
      type="button"
      data-gw-card={side}
      onClick={() => onEnter(side)}
      onPointerMove={onTilt}
      onPointerLeave={untilt}
      aria-label={c.aria}
      className={`tilt-wrap group block text-left focus-visible:outline-none ${
        mobile ? 'absolute inset-0 z-10' : 'relative w-[min(560px,42vw)] px-4'
      }`}
    >
      <motion.div
        animate={leaving ? (side === leaving ? { scale: 1.04, opacity: 1 } : { scale: 1, opacity: 0.7 }) : { scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="h-full w-full"
      >
        <div
          ref={glareRef}
          data-gw-glass={side}
          className={`glass relative flex h-full w-full flex-col justify-center overflow-hidden rounded-[28px] ${
            mobile ? 'p-3' : 'p-6 md:p-10'
          }`}
          style={isKids ? { background: 'rgba(255,251,240,0.88)' } : { background: 'rgba(8,10,12,0.72)' }}
        >
          {isKids ? (
            <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[#FFB347]/35 blur-2xl" aria-hidden="true" />
          ) : (
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              aria-hidden="true"
              style={{ background: 'repeating-linear-gradient(180deg, rgba(0,240,255,0.05) 0 1px, transparent 1px 4px)' }}
            />
          )}

          <span
            data-gw-badge
            className={`mb-2 max-md:mb-1 inline-flex w-fit items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] md:text-xs ${
              isKids ? 'bg-[#FFB347] text-[#4A2800]' : 'border border-[#00F0FF]/40 bg-[#00F0FF]/10 text-[#00F0FF]'
            }`}
          >
            {isKids ? 'Zone A · Ages 2–10' : 'Zone B · Pro Toolkit'}
          </span>

          <h2
            aria-label={c.title}
            className={`text-xl font-extrabold leading-tight sm:text-3xl md:text-[2.4rem] ${
              isKids
                ? 'font-baloo drop-shadow-[0_2px_8px_rgba(93,58,0,0.45)]'
                : 'font-jetbrains drop-shadow-[0_0_16px_rgba(0,240,255,0.35)]'
            }`}
          >
            {isKids ? (
              <ScatterText text={c.title} scattering={leaving === side} from="#9A3412" to="#BE185D" hoverGlow="#FFB347" variant="kids" />
            ) : (
              <ScatterText text={c.title} scattering={leaving === side} from="#00F0FF" to="#FF007F" hoverGlow="#FFFFFF" variant="creator" />
            )}
          </h2>

          <p data-gw-sub className={`mt-2 max-md:mt-1 text-xs md:text-base ${isKids ? 'text-[#8a5a10]' : 'text-[#6FA7A0]'}`}>{c.subtitle}</p>
          <p data-gw-emoji className="mt-1.5 max-md:mt-1 text-base tracking-[0.3em] md:mt-3 md:text-2xl" aria-hidden="true">{c.emoji}</p>

          <div className="mt-2.5 max-md:mt-1.5 flex items-center gap-2 md:mt-6 md:gap-3">
            {c.thumbs.map((t, i) => (
              <img
                key={t.src}
                src={t.src}
                alt={t.alt}
                data-gw-thumb
                width={72}
                height={92}
                className={`h-14 w-10 max-md:h-12 max-md:w-9 rounded-xl object-cover shadow-lg md:h-24 md:w-[4.5rem] ${
                  isKids ? 'border-2 border-[#FFB347]/60' : 'border border-[#00F0FF]/30'
                } ${i === 1 ? (isKids ? 'rotate-2' : '-rotate-2') : ''}`}
              />
            ))}
            <span
              className={`ml-2 hidden flex-col text-[10px] font-semibold uppercase leading-snug tracking-wider sm:flex ${
                isKids ? 'text-[#9c6b1f]' : 'text-[#6FA7A0]'
              }`}
            >
              <span>12 premium</span>
              <span>products inside</span>
            </span>
          </div>

          <span
            data-gw-cta
            className={`mt-2.5 max-md:mt-2 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-transform group-hover:scale-[1.04] md:mt-5 md:px-5 md:py-3 md:text-base ${
              isKids ? 'bg-[#FFB347] text-[#4A2800] shadow-[0_8px_20px_rgba(255,136,0,0.35)]' : 'border border-[#00F0FF]/70 bg-[#00F0FF]/10 text-[#00F0FF] shadow-[0_0_24px_rgba(0,240,255,0.2)]'
            }`}
          >
            {c.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>

          <div className="specular" aria-hidden="true" />
        </div>
      </motion.div>
    </button>
  )
}

/* ── Gateway ──────────────────────────────────────────────── */
export default function GatewayHero() {
  const setCanvasMood = useAppStore((s) => s.setCanvasMood)
  const navigate = useAppStore((s) => s.navigate)
  const reduce = useReducedMotion()
  const [leaving, setLeaving] = useState<Zone | null>(null)
  const heroRef = useRef<HTMLElement>(null)
  const hoveredRef = useRef<Zone | null>(null)
  const angleTgtRef = useRef(0)
  const seamWakeRef = useRef<() => void>(() => undefined)
  const zoneFx = useZoneTransition()

  // Returning visitor: tint the canvas toward their stored zone
  useEffect(() => {
    let z: string | null = null
    try {
      z = window.localStorage.getItem('sdh_zone')
    } catch {
      /* ignore */
    }
    setCanvasMood(z === 'creator' ? 1 : z === 'kids' ? 0 : 0.5)
  }, [setCanvasMood])

  // Desktop seam engine — damped CSS vars via rAF. Heat discipline
  // (T4): the loop STOPS once the seam has converged and wakes on
  // pointer move / hover change / resize. The damping constant and
  // targets are untouched, so hover looks and feels exactly the same.
  useEffect(() => {
    const hero = heroRef.current
    if (!hero || !window.matchMedia('(min-width: 768px)').matches) return
    let w = hero.clientWidth || 1
    let h = hero.clientHeight || 1
    const onResize = () => {
      w = hero.clientWidth || 1
      h = hero.clientHeight || 1
      wake()
    }
    window.addEventListener('resize', onResize)
    const cur = { c: 50, a: 0 }
    let raf = 0
    let running = false
    let last = 0
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const k = 1 - Math.exp(-6 * dt)
      const tgtC = hoveredRef.current === 'kids' ? 58 : hoveredRef.current === 'creator' ? 42 : 50
      cur.c += (tgtC - cur.c) * k
      cur.a += (angleTgtRef.current - cur.a) * k
      hero.style.setProperty('--seam-c', `${cur.c.toFixed(3)}%`)
      const dx = Math.tan((cur.a * Math.PI) / 180) * (h / w) * 50
      hero.style.setProperty('--seam-dx', `${dx.toFixed(3)}%`)
      hero.style.setProperty('--seam-angle', `${cur.a.toFixed(3)}deg`)
      if (Math.abs(tgtC - cur.c) < 0.005 && Math.abs(angleTgtRef.current - cur.a) < 0.005) {
        running = false // converged — no idle burning
        return
      }
      raf = requestAnimationFrame(step)
    }
    const wake = () => {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(step)
    }
    seamWakeRef.current = wake
    wake()
    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const onHover = useCallback(
    (z: Zone | null) => {
      hoveredRef.current = z
      setCanvasMood(z === 'kids' ? 0 : z === 'creator' ? 1 : 0.5)
      // Tier/profile decision is cached at first hover (B3.1); the
      // hovered zone's choreography chunk warms with it.
      zoneFx.prime(z ?? undefined)
      // The seam loop may be idle-converged — wake it for the retarget.
      seamWakeRef.current()
    },
    [setCanvasMood, zoneFx],
  )

  const onHeroMove = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return
    const r = heroRef.current?.getBoundingClientRect()
    if (!r) return
    angleTgtRef.current = ((e.clientX - r.left) / r.width - 0.5) * 12 // ±6°
    seamWakeRef.current()
  }

  const go = useCallback(
    (z: Zone) => {
      if (leaving) return
      setLeaving(z)
      // The 6.5 s zone animation owns zone entry from here: the chosen
      // card plays its signature sequence and enterZone fires hidden
      // under the colour wipe (≈ total − 0.9 s).
      zoneFx.start(z, heroRef.current)
    },
    [leaving, zoneFx],
  )

  const skip = useCallback(() => {
    // During the run, Skip fast-forwards the sequence (B3).
    if (zoneFx.active) {
      zoneFx.skip()
      return
    }
    let z: Zone = 'kids'
    try {
      const stored = window.localStorage.getItem('sdh_zone')
      if (stored === 'creator') z = 'creator'
    } catch {
      /* ignore */
    }
    useAppStore.getState().enterZone(z)
  }, [zoneFx])

  return (
    <section
      ref={heroRef}
      onPointerMove={onHeroMove}
      aria-label="Choose your world"
      className="relative z-10 min-h-[100dvh] w-full overflow-hidden"
      style={{ ['--seam-c' as string]: '50%', ['--seam-dx' as string]: '0%', ['--seam-angle' as string]: '0deg' }}
    >
      {/* ── DESKTOP split panels — the zone animation slides
          these away like heavy doors (gsap owns the transform) ── */}
      <div
        data-gw-panel="left"
        className="absolute inset-0 hidden md:block"
        style={{ clipPath: LEFT_CLIP, background: 'linear-gradient(135deg,#FFF2CC 0%,#FFE9B8 45%,#FCE5CD 100%)' }}
        onPointerEnter={() => onHover('kids')}
        onPointerLeave={() => onHover(null)}
      >
        <div className="absolute left-[8%] top-[12%] h-56 w-56 rounded-full bg-[#FFB347]/40 blur-3xl" aria-hidden="true" />
        <div className="absolute bottom-[10%] left-[30%] h-48 w-48 rounded-full bg-[#F2789F]/30 blur-3xl" aria-hidden="true" />
        <div
          className="absolute left-0 top-0 flex h-full items-center justify-center"
          style={{ width: 'calc(var(--seam-c, 50%) + var(--seam-dx, 0%))' }}
        >
          <SideCard side="kids" leaving={leaving} onEnter={go} />
        </div>
      </div>

      <div
        data-gw-panel="right"
        className="absolute inset-0 hidden md:block"
        style={{ clipPath: RIGHT_CLIP, background: 'linear-gradient(135deg,#0A0D0C 0%,#101614 60%,#0A0D0C 100%)' }}
        onPointerEnter={() => onHover('creator')}
        onPointerLeave={() => onHover(null)}
      >
        <div className="absolute right-[10%] top-[14%] h-56 w-56 rounded-full bg-[#00F0FF]/25 blur-3xl" aria-hidden="true" />
        <div className="absolute bottom-[12%] right-[32%] h-48 w-48 rounded-full bg-[#FF007F]/20 blur-3xl" aria-hidden="true" />
        <div
          className="absolute right-0 top-0 flex h-full items-center justify-center"
          style={{ width: 'calc(100% - var(--seam-c, 50%) + var(--seam-dx, 0%))' }}
        >
          <SideCard side="creator" leaving={leaving} onEnter={go} />
        </div>
      </div>

      {/* glowing seam line — the zone animation fades it out */}
      <div
        data-gw-seam
        aria-hidden="true"
        className="absolute top-[-5%] z-10 hidden h-[110%] w-0.5 md:block"
        style={{
          left: 'var(--seam-c, 50%)',
          transform: 'translateX(-50%) rotate(var(--seam-angle, 0deg))',
          background: 'linear-gradient(180deg, transparent, rgba(229,184,66,0.75) 22%, rgba(255,246,216,0.9) 50%, rgba(229,184,66,0.75) 78%, transparent)',
        }}
      />

      {/* ── centre monogram column (fades into the wipe with the
          rest of the gateway — driven by the choreography) ── */}
      <div
        data-gw-mono
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 hidden -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 md:flex"
      >
        <Image
          src="/brand/logo-mark.png"
          alt=""
          width={117}
          height={117}
          priority
          aria-hidden="true"
          className="h-[117px] w-[117px] object-contain drop-shadow-[0_0_24px_rgba(229,184,66,0.55)]"
        />
        <h1 className="holo-text font-cinzel text-center text-xl tracking-[0.18em] md:text-2xl">SIBRA DIGITAL HUB</h1>
        <p className="glass rounded-full px-4 py-1.5 text-center text-xs text-[#F5F8F6] md:text-sm">
          Instant downloads. Pay by card, UPI, net banking & more.
        </p>
      </div>

      {/* ── MOBILE stacked cards ── */}
      <div className="relative z-10 flex min-h-[100dvh] flex-col gap-2 px-4 pb-1 pt-2 md:hidden">
        <div data-gw-mheader className="flex shrink-0 flex-col items-center gap-1 text-center">
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={52}
            height={52}
            priority
            aria-hidden="true"
            className="h-[52px] w-[52px] object-contain drop-shadow-[0_0_14px_rgba(229,184,66,0.45)]"
          />
          <h1 className="holo-text font-cinzel text-base tracking-[0.16em]">SIBRA DIGITAL HUB</h1>
          <p className="text-[13px] font-medium leading-snug text-[#D6E2D8]">Instant downloads. Pay by card, UPI, net banking & more.</p>
        </div>

        <div className="flex flex-1 flex-col gap-2 px-[2px]">
          {(['kids', 'creator'] as Zone[]).map((side) => (
            <motion.div
              key={side}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.4, bottom: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.y < -60) go(side)
              }}
              whileTap={{ scale: 0.99 }}
              data-gw-shell={side}
              className={`relative min-h-[224px] flex-1 overflow-hidden rounded-[28px] ${
                side === 'kids'
                  ? 'bg-gradient-to-br from-[#FFF2CC] via-[#FFE9B8] to-[#FCE5CD] shadow-[0_14px_36px_rgba(255,136,0,0.25)]'
                  : 'bg-[#0A0D0C] shadow-[0_14px_36px_rgba(0,240,255,0.12)]'
              }`}
            >
            {side === 'creator' && (
              <div
                className="pointer-events-none absolute inset-0 opacity-40"
                aria-hidden="true"
                style={{ background: 'repeating-linear-gradient(180deg, rgba(0,240,255,0.05) 0 1px, transparent 1px 4px)' }}
              />
            )}
            <SideCard side={side} leaving={leaving} onEnter={go} mobile />
            <p
              className={`pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 text-[10px] font-semibold uppercase tracking-widest ${
                side === 'kids' ? 'text-[#9c6b1f]' : 'text-[#6FA7A0]'
              }`}
            >
              <ChevronUp className="h-3 w-3 animate-bounce" aria-hidden="true" /> swipe up or tap
            </p>
            </motion.div>
          ))}
        </div>

        {/* ── Skip + Admin (mobile, in-flow below the cards) ── */}
        <div data-gw-skip className="z-30 flex shrink-0 items-center justify-center gap-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-0">
          <button
            type="button"
            onClick={skip}
            className="glass rounded-full px-6 py-2 text-sm font-semibold text-[#F5F8F6] focus-visible:outline-none"
          >
            Skip →
          </button>
          {SHOW_ADMIN_BUTTON && (
            <button
              type="button"
              onClick={() => navigate('admin')}
              aria-label="Admin console login"
              className="glass flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-[#9AA89E] transition-colors hover:text-[#E5B842] focus-visible:outline-none"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Admin
            </button>
          )}
        </div>
      </div>

      {/* ── Skip + Admin (desktop, absolute bottom-centre) ── */}
      <div data-gw-skip className="absolute bottom-4 left-1/2 z-30 hidden -translate-x-1/2 items-center justify-center gap-3 md:flex">
        <button
          type="button"
          onClick={skip}
          className="glass rounded-full px-6 py-2.5 text-sm font-semibold text-[#F5F8F6] transition-transform hover:scale-105 focus-visible:outline-none"
        >
          Skip →
        </button>
        {SHOW_ADMIN_BUTTON && (
          <button
            type="button"
            onClick={() => navigate('admin')}
            aria-label="Admin console login"
            className="glass flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-[#9AA89E] transition-colors hover:text-[#E5B842] focus-visible:outline-none"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Admin
          </button>
        )}
      </div>

      {/* Zone signature animation overlay is hosted by the page shell
          (HomeShell) so it survives this section's unmount at zone
          entry — see components/zone-transition. */}

    </section>
  )
}
