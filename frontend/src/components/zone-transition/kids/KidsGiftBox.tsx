'use client'

// ═══════════════════════════════════════════════════════════
// KidsGiftBox — "Magic Gift Box Pop" (B4): the real GSAP
// choreography. Renders inside the stage's content layer,
// builds ONE master timeline (registered via ChoreoHooks — the
// stage owns skip/watchdog/done), drives ONE pooled Particles2D
// canvas behind the DOM items, and tweens ONLY transform/
// opacity (+ the stage wipe's opacity and capped inner flash).
// Zero React state per frame; every element is removed with the
// overlay, so inline will-change never outlives the run.
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, type JSX } from 'react'
import gsap from 'gsap'
import { GATEWAY_CONTENT } from '@/lib/gateway-content'
import { BASE_TOTAL_MS, KIDS_BEATS, KIDS_COLORS, type ChoreoProps } from '../config/constants'
import { MOTION_PROFILES } from '../config/motion-profiles'
import { budgetFor } from '../config/tiers'
import { clampTotal, scaleBeats } from '../core/timeline'
import { Particles2D } from '../stage/Particles2D'
import { introStretch, kidsWipeWindow, planKidsLayout, type KidsItemSpot } from './kids-beats'
import { pushCardSquash, pushGatewayExit, pushLevelUp, pushPayoffWipe, pushPop, pushTreasureRain, type KidsStage } from './kids-timeline'
import { playKidsScore } from './kids-sound'
import Balloon from './kids-items/Balloon'
import Block3D from './kids-items/Block3D'
import Crayon from './kids-items/Crayon'
import ProductCard3D from './kids-items/ProductCard3D'
import PuzzlePiece from './kids-items/PuzzlePiece'
import Rainbow from './kids-items/Rainbow'
import StarMeter from './kids-items/StarMeter'

const GLYPHS = ['A', 'B', 'C', '1', '2', '3']
const TINTS = [KIDS_COLORS.rose, KIDS_COLORS.sky, KIDS_COLORS.mint, KIDS_COLORS.amber, KIDS_COLORS.orange, KIDS_COLORS.yellow]

function FlyingStar(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: '6vmin', height: '6vmin' }}>
      <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" fill={KIDS_COLORS.yellow} stroke="#E8A200" strokeWidth="1.2" />
    </svg>
  )
}

/** One treasure item by kind — all decorative, all sized in vmin. */
function ItemVisual({ spot, index }: { spot: KidsItemSpot; index: number }): JSX.Element {
  switch (spot.kind) {
    case 'block':
      return <Block3D glyph={GLYPHS[index % GLYPHS.length]} tint={TINTS[index % TINTS.length]} />
    case 'crayon':
      return <Crayon tint={TINTS[index % TINTS.length]} />
    case 'puzzle':
      return <PuzzlePiece tint={TINTS[(index + 2) % TINTS.length]} />
    case 'balloon':
      return <Balloon tint={TINTS[index % TINTS.length]} />
    case 'star':
      return <FlyingStar />
    case 'card':
      return <ProductCard3D index={index} />
  }
}

export default function KidsGiftBox(props: ChoreoProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // ChoreoProps are immutable for the whole run — capture the first ones
  // (same render-once pattern as ZoneStage's machineRef) so the run effect
  // can depend on [] without restarting when the shell re-renders.
  const runRef = useRef<ChoreoProps | null>(null)
  if (runRef.current == null) runRef.current = props

  const profile = MOTION_PROFILES[props.profile]
  const budget = budgetFor(props.tier)
  const spots = useMemo(
    () => planKidsLayout(budget.domItems, profile.particleScale),
    [budget.domItems, profile.particleScale],
  )
  const hero = props.heroRect
  const vw = typeof window === 'undefined' ? 1 : window.innerWidth
  const vh = typeof window === 'undefined' ? 1 : window.innerHeight
  const fx = hero ? (hero.x + hero.width / 2) / vw : 0.5
  const fy = hero ? (hero.y + hero.height / 2) / vh : 0.45

  useEffect(() => {
    const run = runRef.current
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!run || !root || !canvas) return
    const prof = MOTION_PROFILES[run.profile]
    const tierBudget = budgetFor(run.tier)
    const totalMs = clampTotal(run.totalMs)
    const k = totalMs / BASE_TOTAL_MS
    const b = scaleBeats(KIDS_BEATS, run.totalMs)
    const tempo = introStretch(prof)
    const vwPx = window.innerWidth || 1
    const vhPx = window.innerHeight || 1
    const rect = run.heroRect
    const cfx = rect ? (rect.x + rect.width / 2) / vwPx : 0.5
    const cfy = rect ? (rect.y + rect.height / 2) / vhPx : 0.45
    const phone = window.matchMedia?.('(max-width: 1024px)').matches || navigator.maxTouchPoints > 1

    const particles = new Particles2D(canvas, {
      max: Math.max(8, Math.round(tierBudget.particles * prof.particleScale)),
      fpsCap: phone ? 30 : 60,
    })
    particles.resume()
    const onResize = () => particles.resize()
    window.addEventListener('resize', onResize, { passive: true })

    const popAt = b.anticipateEnd * tempo
    const layout = planKidsLayout(tierBudget.domItems, prof.particleScale)
    const gsapCtx = gsap.context(() => {
      const tl = gsap.timeline()
      run.hooks.registerTimeline(tl)
      const stage: KidsStage = {
        tl,
        profile: prof,
        b,
        k,
        tempo,
        popAt,
        fx: cfx,
        fy: cfy,
        vw: vwPx,
        vh: vhPx,
        particles,
        spots: layout,
        root,
        wipe: run.hooks.wipeRef.current,
        onEnterZone: () => run.onEnterZone('kids'),
      }
      pushGatewayExit(tl, 'kids', k)
      pushCardSquash(tl, 'kids', k, tempo, popAt)
      pushPop(tl, stage)
      pushTreasureRain(tl, stage)
      pushLevelUp(tl, stage)
      pushPayoffWipe(tl, stage, kidsWipeWindow(run.totalMs))
    }, root)

    const score = playKidsScore(run.totalMs, prof)
    run.hooks.registerScore(score)
    run.onPhase('playing')

    return () => {
      run.hooks.registerScore(null)
      run.hooks.registerTimeline(null)
      score?.dispose()
      gsapCtx.revert()
      window.removeEventListener('resize', onResize)
      particles.dispose()
    }
  }, [])

  return (
    <div ref={rootRef} className="absolute inset-0" style={{ perspective: '1100px' }}>
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      <div
        data-k-rainbow-wrap
        aria-hidden="true"
        className="absolute"
        style={{ left: '50%', top: '40%', width: '68vmin', height: '34vmin', transform: 'translate(-50%, -50%)', opacity: 0, willChange: 'opacity' }}
      >
        <Rainbow />
      </div>
      <div
        data-k-glow
        aria-hidden="true"
        className="absolute"
        style={{
          left: `${(fx * 100).toFixed(2)}%`,
          top: `${(fy * 100).toFixed(2)}%`,
          width: '70vmin',
          height: '70vmin',
          marginLeft: '-35vmin',
          marginTop: '-35vmin',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(255,179,71,0.4) 0%, rgba(255,179,71,0) 65%)`,
          opacity: 0,
          willChange: 'opacity',
        }}
      />
      <div
        data-k-box
        aria-hidden="true"
        className="absolute"
        style={{
          left: `${(fx * 100).toFixed(2)}%`,
          top: `${(fy * 100).toFixed(2)}%`,
          width: '30vmin',
          height: '26vmin',
          marginLeft: '-15vmin',
          marginTop: '-13vmin',
          transformStyle: 'preserve-3d',
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      >
        <div
          data-k-body
          className="absolute inset-0"
          style={{
            borderRadius: '2.6vmin',
            background: `linear-gradient(160deg, ${KIDS_COLORS.amber} 0%, ${KIDS_COLORS.orange} 78%)`,
            boxShadow: 'inset 0 -2.2vmin 0 rgba(0,0,0,0.08)',
          }}
        >
          <div className="absolute" style={{ left: '42%', top: 0, bottom: 0, width: '16%', background: KIDS_COLORS.rose, opacity: 0.9 }} />
          <div className="absolute" style={{ left: '8%', right: '8%', top: '6%', height: '16%', borderRadius: '2vmin', background: 'linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0))' }} />
        </div>
        <div
          data-k-lid
          className="absolute"
          style={{ left: '-4%', right: '-4%', top: '-14%', height: '30%', transformOrigin: '50% 0%', transformStyle: 'preserve-3d', willChange: 'transform' }}
        >
          <div className="absolute inset-0" style={{ borderRadius: '2.2vmin', background: `linear-gradient(150deg, ${KIDS_COLORS.rose}, #D95E85)` }} />
          <div className="absolute" style={{ left: '38%', top: '-42%', width: '10%', height: '52%', borderRadius: '50%', background: KIDS_COLORS.amber, border: `0.5vmin solid ${KIDS_COLORS.orange}` }} />
          <div className="absolute" style={{ left: '52%', top: '-42%', width: '10%', height: '52%', borderRadius: '50%', background: KIDS_COLORS.amber, border: `0.5vmin solid ${KIDS_COLORS.orange}` }} />
        </div>
      </div>
      {spots.map((spot, i) => (
        <div
          key={`${spot.kind}-${i}`}
          data-k-fly={i}
          aria-hidden="true"
          className="absolute grid place-items-center"
          style={{
            left: `${(fx * 100).toFixed(2)}%`,
            top: `${(fy * 100).toFixed(2)}%`,
            width: 0,
            height: 0,
            opacity: 0,
            transformStyle: 'preserve-3d',
            willChange: 'transform, opacity',
          }}
        >
          <ItemVisual spot={spot} index={i} />
        </div>
      ))}
      <StarMeter />
      <svg
        data-k-burst
        aria-hidden="true"
        viewBox="0 0 100 100"
        className="absolute"
        style={{ left: '50%', top: '46%', width: '52vmin', height: '52vmin', marginLeft: '-26vmin', marginTop: '-26vmin', opacity: 0, willChange: 'transform, opacity' }}
      >
        <path d="M50 2l9 26 27-9-16 23 25 14-28 3 6 28-23-17-23 17 6-28-28-3 25-14-16-23 27 9z" fill={KIDS_COLORS.yellow} stroke={KIDS_COLORS.amber} strokeWidth="2" />
      </svg>
      <p
        data-k-cta
        className="absolute"
        style={{
          left: '50%',
          bottom: '9%',
          transform: 'translateX(-50%)',
          padding: '0.7rem 1.4rem',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.92)',
          color: '#5B4A21',
          fontWeight: 800,
          fontSize: 'clamp(0.95rem, 2.4vmin, 1.3rem)',
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      >
        {GATEWAY_CONTENT.kids.cta}
      </p>
    </div>
  )
}
