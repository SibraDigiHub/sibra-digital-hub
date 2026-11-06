'use client'

// ═══════════════════════════════════════════════════════════
// CreatorBuild — "Neon Build & Deploy" (B5): the real GSAP
// choreography. Renders inside the stage's content layer,
// builds ONE master timeline (registered via ChoreoHooks — the
// stage owns skip/watchdog/done), drives ONE pooled Canvas-2D
// layer (CodeRain2D), and tweens ONLY transform/opacity (+ the
// stage wipe's opacity and capped inner flash). Zero React
// state per frame; the ring counter and typing text are direct
// DOM writes from timeline onUpdate callbacks.
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, type JSX } from 'react'
import gsap from 'gsap'
import { GATEWAY_CONTENT } from '@/lib/gateway-content'
import { BASE_TOTAL_MS, CREATOR_BEATS, CREATOR_COLORS, type ChoreoProps } from '../config/constants'
import { MOTION_PROFILES } from '../config/motion-profiles'
import { budgetFor } from '../config/tiers'
import { clampTotal, scaleBeats } from '../core/timeline'
import { introStretch, creatorWipeWindow, planCreatorLayout } from './creator-beats'
import { pushBoot, pushBuild, pushCompile, pushGatewayExit, pushIgnite, pushShipWipe, type CreatorStage } from './creator-timeline'
import { playCreatorScore } from './creator-sound'
import CodeRain2D, { type CodeRainApi } from './creator-items/CodeRain2D'
import Glitch from './creator-items/Glitch'
import GridFloor from './creator-items/GridFloor'
import HoloWindow, { type HoloKind } from './creator-items/HoloWindow'
import ProductCard3D from './creator-items/ProductCard3D'
import ProgressRing from './creator-items/ProgressRing'

const WINDOW_KINDS: HoloKind[] = ['template', 'prompt', 'script', 'uikit']
const CUBE_GLYPHS = ['{ }', '</>', 'fn()']

function ItemVisual({ kind, index }: { kind: 'window' | 'cube' | 'card'; index: number }): JSX.Element {
  if (kind === 'window') return <HoloWindow kind={WINDOW_KINDS[index % WINDOW_KINDS.length]} />
  if (kind === 'card') return <ProductCard3D index={index} />
  return (
    <div
      aria-hidden="true"
      className="grid place-items-center font-mono"
      style={{
        width: '7.5vmin',
        height: '7.5vmin',
        borderRadius: '1vmin',
        background: 'rgba(8,12,10,0.9)',
        border: `2px solid ${CREATOR_COLORS.green}`,
        color: CREATOR_COLORS.green,
        fontSize: '1.7vmin',
        transformStyle: 'preserve-3d',
      }}
    >
      {CUBE_GLYPHS[index % CUBE_GLYPHS.length]}
    </div>
  )
}

export default function CreatorBuild(props: ChoreoProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const rainRef = useRef<CodeRainApi | null>(null)
  // ChoreoProps are immutable for the whole run — capture the first ones
  // (same render-once pattern as ZoneStage's machineRef) so the run effect
  // can depend on [] without restarting when the shell re-renders.
  const runRef = useRef<ChoreoProps | null>(null)
  if (runRef.current == null) runRef.current = props

  const budget = budgetFor(props.tier)
  const layout = useMemo(
    () => planCreatorLayout(budget.domItems, MOTION_PROFILES[props.profile].particleScale, budget.codeRainColumns),
    [budget.domItems, budget.codeRainColumns, props.profile],
  )
  const hero = props.heroRect
  const vw = typeof window === 'undefined' ? 1 : window.innerWidth
  const vh = typeof window === 'undefined' ? 1 : window.innerHeight
  const fx = hero ? (hero.x + hero.width / 2) / vw : 0.5
  const fy = hero ? (hero.y + hero.height / 2) / vh : 0.45

  useEffect(() => {
    const run = runRef.current
    const root = rootRef.current
    if (!run || !root) return
    const prof = MOTION_PROFILES[run.profile]
    const tierBudget = budgetFor(run.tier)
    const totalMs = clampTotal(run.totalMs)
    const k = totalMs / BASE_TOTAL_MS
    const b = scaleBeats(CREATOR_BEATS, run.totalMs)
    const tempo = introStretch(prof)
    const vwPx = window.innerWidth || 1
    const vhPx = window.innerHeight || 1
    const rect = run.heroRect
    const phone = window.matchMedia?.('(max-width: 1024px)').matches || navigator.maxTouchPoints > 1

    const onResize = () => rainRef.current?.resize()
    window.addEventListener('resize', onResize, { passive: true })

    const gsapCtx = gsap.context(() => {
      const tl = gsap.timeline()
      run.hooks.registerTimeline(tl)
      const stage: CreatorStage = {
        tl,
        profile: prof,
        b,
        k,
        tempo,
        bootAt: b.igniteEnd * tempo,
        bootEndEff: b.igniteEnd * tempo + (b.bootEnd - b.igniteEnd) * k,
        vw: vwPx,
        vh: vhPx,
        layout: planCreatorLayout(tierBudget.domItems, prof.particleScale, tierBudget.codeRainColumns),
        root,
        wipe: run.hooks.wipeRef.current,
        rain: rainRef,
        onEnterZone: () => run.onEnterZone('creator'),
      }
      pushGatewayExit(tl, k)
      pushIgnite(tl, stage)
      pushBoot(tl, stage)
      pushBuild(tl, stage)
      pushCompile(tl, stage)
      pushShipWipe(tl, stage, creatorWipeWindow(run.totalMs))
    }, root)

    const score = playCreatorScore(run.totalMs, prof)
    run.hooks.registerScore(score)
    run.onPhase('playing')

    return () => {
      run.hooks.registerScore(null)
      run.hooks.registerTimeline(null)
      score?.dispose()
      gsapCtx.revert()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div ref={rootRef} className="absolute inset-0" style={{ perspective: '1100px' }}>
      <div
        data-c-base
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: `radial-gradient(120% 90% at 50% 42%, #0B120F 0%, ${CREATOR_COLORS.obsidian} 62%)`, opacity: 0, willChange: 'opacity' }}
      />
      <CodeRain2D
        max={Math.max(8, Math.round(budget.particles * MOTION_PROFILES[props.profile].particleScale))}
        fpsCap={typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 1024px)').matches || navigator.maxTouchPoints > 1) ? 30 : 60}
        apiRef={rainRef}
      />
      <GridFloor />
      <div
        data-c-scan
        aria-hidden="true"
        className="absolute left-0 right-0"
        style={{ top: 0, height: 2, background: `linear-gradient(90deg, transparent, ${CREATOR_COLORS.cyan}CC, transparent)`, opacity: 0, willChange: 'transform, opacity' }}
      />
      <div aria-hidden="true" className="absolute text-center" style={{ left: '50%', top: '6%', transform: 'translateX(-50%)' }}>
        {/* textContent is typed in by the timeline — starts empty, real title only */}
        <span
          data-c-title
          data-c-full={GATEWAY_CONTENT.creator.title}
          className="font-mono inline-block"
          style={{ color: CREATOR_COLORS.cyan, fontSize: 'clamp(1rem, 3.4vmin, 2rem)', fontWeight: 700, letterSpacing: '0.14em', textShadow: `0 0 18px ${CREATOR_COLORS.cyan}55` }}
        />
        <span data-c-cursor className="font-mono" style={{ color: CREATOR_COLORS.green, opacity: 0, fontSize: 'clamp(1rem, 3.4vmin, 2rem)' }}>
          ▍
        </span>
      </div>
      <div
        data-c-ignite
        aria-hidden="true"
        className="absolute"
        style={{
          left: `${(fx * 100).toFixed(2)}%`,
          top: `${(fy * 100).toFixed(2)}%`,
          width: '36vmin',
          height: '24vmin',
          marginLeft: '-18vmin',
          marginTop: '-12vmin',
          borderRadius: '18px',
          background: 'rgba(8,12,10,0.88)',
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      >
        <div className="absolute inset-0" style={{ borderRadius: '18px', border: `2px solid ${CREATOR_COLORS.cyan}`, opacity: 0.8 }} />
        <Glitch />
      </div>
      {layout.items.map((item, i) => (
        <div
          key={`${item.kind}-${i}`}
          data-c-item={i}
          aria-hidden="true"
          className="absolute grid place-items-center"
          style={{ left: '50%', top: '45%', width: 0, height: 0, opacity: 0, transformStyle: 'preserve-3d', willChange: 'transform, opacity' }}
        >
          <ItemVisual kind={item.kind} index={item.index} />
        </div>
      ))}
      <ProgressRing segments={layout.segments} />
      <div
        data-c-shock
        aria-hidden="true"
        className="absolute"
        style={{ left: '50%', top: '45%', width: '30vmin', height: '30vmin', marginLeft: '-15vmin', marginTop: '-15vmin', borderRadius: '50%', border: `0.45vmin solid ${CREATOR_COLORS.cyan}`, opacity: 0, willChange: 'transform, opacity' }}
      />
      {[CREATOR_COLORS.cyan, CREATOR_COLORS.magenta, CREATOR_COLORS.gold].map((color, i) => (
        <div
          key={color}
          data-c-beam={i}
          aria-hidden="true"
          className="absolute"
          style={{
            left: `${28 + i * 20}%`,
            top: '-8%',
            width: '2.4vmin',
            height: '116%',
            transformOrigin: '50% 0%',
            background: `linear-gradient(180deg, ${color}, transparent)`,
            opacity: 0,
            willChange: 'transform, opacity',
          }}
        />
      ))}
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path data-c-arc-line="0" d="M18 72 L31 52 L26 38 L41 28" fill="none" stroke={CREATOR_COLORS.cyan} strokeWidth="0.5" opacity="0" />
        <path data-c-arc-line="1" d="M79 66 L66 48 L72 36 L57 26" fill="none" stroke={CREATOR_COLORS.gold} strokeWidth="0.5" opacity="0" />
      </svg>
      <p
        data-c-cta
        className="absolute font-mono"
        style={{
          left: '50%',
          bottom: '9%',
          transform: 'translateX(-50%)',
          padding: '0.7rem 1.4rem',
          borderRadius: 999,
          background: 'rgba(5,7,6,0.92)',
          border: `1px solid ${CREATOR_COLORS.cyan}66`,
          color: CREATOR_COLORS.cyan,
          fontWeight: 700,
          fontSize: 'clamp(0.95rem, 2.4vmin, 1.3rem)',
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      >
        {GATEWAY_CONTENT.creator.cta}
      </p>
    </div>
  )
}
