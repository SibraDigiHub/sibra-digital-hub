'use client'

// ═══════════════════════════════════════════════════════════
// ReducedCpuStage (B6) — the T0 variant for BOTH zones (and the
// temporary full storyline on every tier until the real
// choreographies land in zone-anim-2): same beat shape as the
// master prompt (kids = gift-box pop, creator = boot/build),
// implemented with pure CSS keyframes injected via ONE scoped
// <style> tag. No canvas, no GSAP, NO timers — animation fill
// modes drive everything from delays derived from the scaled
// beats; the stage still owns onEnterZone/onDone timing.
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, type CSSProperties, type JSX, type ReactNode } from 'react'
import { CREATOR_BEATS, CREATOR_COLORS, KIDS_BEATS, KIDS_COLORS, PRODUCT_ART, WIPE_STYLE, type ChoreoProps, type Zone } from '../config/constants'
import { MOTION_PROFILES } from '../config/motion-profiles'
import { scaleBeats } from '../core/timeline'

let seq = 0

/** Deterministic 0..1 hash — seeded randomness, stable across renders. */
const rnd = (i: number, salt: number): number => {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return v - Math.floor(v)
}

type Vars = CSSProperties & Record<`--${string}`, string | number>

/** Item flight: from the hero centre (--x0/--y0) to a scattered target (--x1/--y1). */
function floatVars(i: number, salt: number, cx: string, cy: string): Vars {
  return {
    '--x0': cx,
    '--y0': cy,
    '--x1': `${6 + rnd(i, salt) * 82}vw`,
    '--y1': `${16 + rnd(i, salt + 1) * 64}vh`,
    '--r0': `${(rnd(i, salt + 2) - 0.5) * 40}deg`,
    '--r1': `${(rnd(i, salt + 3) - 0.5) * 50}deg`,
  } as Vars
}

function buildCss(scope: string, zone: Zone, peak: number): string {
  return `
.${scope} { position: absolute; inset: 0; overflow: hidden; perspective: 900px; }
.${scope} .abs { position: absolute; }
@keyframes zcw-squash { 0%,100% { transform: scale(1) } 55% { transform: translateY(4px) scale(0.94, 1.04) } }
@keyframes zcw-pop { 0% { transform: scale(1); opacity: 1 } 70% { transform: scale(1.14); opacity: 1 } 100% { transform: scale(1.3); opacity: 0 } }
@keyframes zcw-lid { to { transform: rotateX(-118deg) translateZ(6px) } }
@keyframes zcw-bounce { 0%,100% { transform: translateY(0) } 45% { transform: translateY(9px) } }
@keyframes zcw-in { from { transform: translate3d(var(--x0), var(--y0), 0) rotate(var(--r0)); opacity: 0 } 55% { opacity: 1 } to { transform: translate3d(var(--x1), var(--y1), 0) rotate(var(--r1)); opacity: 1 } }
@keyframes zcw-bob { from { transform: translate3d(var(--x1), var(--y1), 0) rotate(var(--r1)) } to { transform: translate3d(var(--x1), calc(var(--y1) - 12px), 0) rotate(var(--r1)) } }
@keyframes zcw-fall { from { transform: translate3d(var(--x0), var(--y0), 0) rotate(0deg); opacity: 1 } to { transform: translate3d(var(--x1), var(--y1), 0) rotate(340deg); opacity: 0 } }
@keyframes zcw-draw { from { transform: scaleX(0); opacity: 0 } 30% { opacity: 1 } to { transform: scaleX(1); opacity: 0.9 } }
@keyframes zcw-spin { from { transform: rotate(0deg) scale(0.55); opacity: 0 } 30% { opacity: 1 } to { transform: rotate(320deg) scale(1); opacity: 1 } }
@keyframes zcw-starpop { 0% { transform: scale(0) rotate(-45deg); opacity: 0 } 60% { transform: scale(1.3) rotate(52deg); opacity: 1 } 100% { transform: scale(1) rotate(45deg); opacity: 1 } }
@keyframes zcw-flash { 0%,100% { opacity: 0 } 45% { opacity: ${peak} } }
@keyframes zcw-burst { 0% { transform: scale(0.2); opacity: 0 } 40% { opacity: 1 } 100% { transform: scale(1.8); opacity: 0 } }
@keyframes zcw-wipe { from { opacity: 0 } to { opacity: 1 } }
@keyframes zcw-ignite { 0%,18%,36% { opacity: 0.12 } 9%,27% { opacity: 0.85 } 46%,100% { opacity: 1 } }
@keyframes zcw-scan { 0% { transform: translateY(-12vh); opacity: 0 } 12% { opacity: 0.55 } 100% { transform: translateY(112vh); opacity: 0 } }
@keyframes zcw-grid { from { transform: rotateX(64deg) translateY(0) } to { transform: rotateX(64deg) translateY(34%) } }
@keyframes zcw-type { 0% { opacity: 0 } 12%,16% { opacity: 0.65 } 22% { opacity: 0.15 } 32%,38% { opacity: 0.85 } 46% { opacity: 0.3 } 58%,100% { opacity: 1 } }
@keyframes zcw-snap { 0% { transform: scale(1.14); opacity: 0 } 55% { opacity: 1 } 78% { transform: scale(0.98) } 100% { transform: scale(1); opacity: 1 } }
@keyframes zcw-rain { from { transform: translateY(-35%) } to { transform: translateY(125%) } }
@keyframes zcw-ring { 0% { transform: scale(0.25); opacity: 0.85 } 100% { transform: scale(2.3); opacity: 0 } }
@keyframes zcw-beam { 0% { transform: scaleY(0); opacity: 0 } 30% { opacity: 0.85 } 100% { transform: scaleY(1); opacity: 0 } }
@keyframes zcw-win { from { opacity: 0 } to { opacity: 1 } }
.${scope} .wipe { background: ${WIPE_STYLE[zone].background}; }
`
}

interface TreeCtx {
  beats: Record<string, number>
  prof: (typeof MOTION_PROFILES)['full']
  anim: (name: string, dur: number, delay: number, opts?: { timing?: string; iter?: string }) => CSSProperties
  anim2: (n1: string, d1: number, del1: number, n2: string, d2: number, del2: number) => CSSProperties
  flying: (n: number, salt: number, delayA: number, delayB: number, render: (i: number) => ReactNode) => ReactNode[]
  C: string
  CY: string
}

/** Kids storyline: squash → POP → treasure rain → 3-star level-up → ta-da burst. */
function kidsTree(ctx: TreeCtx): ReactNode {
  const { beats, prof, anim, flying, C, CY } = ctx
  return (
    <>
      {prof.screenShake && <div className="abs inset-0" style={anim('zcw-bounce', 0.5, beats.anticipateEnd)} />}
      <div className="abs" style={{ left: C, top: CY, width: '30vw', height: '30vw', marginLeft: '-15vw', marginTop: '-15vw', transformStyle: 'preserve-3d', ...anim('zcw-pop', beats.popEnd - beats.anticipateEnd, beats.anticipateEnd) }}>
        <div className="abs inset-0" style={{ borderRadius: '2vw', background: `linear-gradient(160deg, ${KIDS_COLORS.amber}, ${KIDS_COLORS.orange})`, ...anim('zcw-squash', beats.anticipateEnd, 0) }} />
        <div className="abs" style={{ left: 0, right: 0, top: '-3vw', height: '5vw', borderRadius: '2vw', background: KIDS_COLORS.rose, transformOrigin: 'top center', ...anim('zcw-lid', beats.popEnd - beats.anticipateEnd, beats.anticipateEnd) }} />
      </div>
      {Array.from({ length: Math.round(14 * prof.particleScale) }, (_, i) => {
        const spread = Math.max(0.2, beats.treasureEnd - beats.popEnd)
        return (
          <div key={i} className="abs" style={{ ...floatVars(i, 9, C, CY), ...anim('zcw-fall', 1.2 + rnd(i, 13), beats.popEnd + rnd(i, 14) * spread) }}>
            <div style={{ width: 10, height: 14, borderRadius: 3, background: Object.values(KIDS_COLORS)[i % 8] }} />
          </div>
        )
      })}
      {flying(6, 3, beats.popEnd, beats.treasureEnd * 0.7, (i) => (
        <div style={{ width: '9vw', height: '9vw', borderRadius: '1.4vw', background: `linear-gradient(150deg, ${KIDS_COLORS.sky}, ${KIDS_COLORS.mint})`, color: '#5B4A21', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4.5vw', fontWeight: 800 }}>{['A', 'B', 'C', '1', '2', '3'][i]}</div>
      ))}
      {flying(3, 17, beats.popEnd + 0.2, beats.treasureEnd, (i) => (
        <div style={{ width: '7vw', height: '9.5vw', borderRadius: '50% 50% 45% 45%', background: `radial-gradient(circle at 35% 30%, #fff9, ${[KIDS_COLORS.rose, KIDS_COLORS.sky, KIDS_COLORS.mint][i]})` }} />
      ))}
      {flying(3, 23, beats.treasureEnd * 0.4, beats.levelEnd * 0.8, (i) => (
        <img src={PRODUCT_ART.kids[i]} alt="" width={140} height={140} style={{ width: '13vw', height: '13vw', objectFit: 'cover', borderRadius: '1.2vw', border: `4px solid ${KIDS_COLORS.cream}` }} />
      ))}
      <div className="abs" style={{ left: '20vw', top: '30vh', width: '60vw', height: '14vh', borderRadius: '999px', background: `linear-gradient(90deg, ${KIDS_COLORS.rose}, ${KIDS_COLORS.amber}, ${KIDS_COLORS.yellow}, ${KIDS_COLORS.mint}, ${KIDS_COLORS.sky})`, ...anim('zcw-draw', beats.treasureEnd - beats.popEnd, beats.popEnd) }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="abs" style={{ left: `${41 + i * 9}vw`, top: '16vh', width: '5vw', height: '5vw', background: KIDS_COLORS.yellow, borderRadius: '0.6vw', ...anim('zcw-starpop', 0.5, beats.treasureEnd + ((i + 1) * (beats.levelEnd - beats.treasureEnd)) / 3) }} />
      ))}
      <div className="abs inset-0" style={{ background: `radial-gradient(circle at 50% 45%, ${KIDS_COLORS.yellow}, transparent 60%)`, ...anim('zcw-flash', beats.payoffEnd - beats.levelEnd, beats.levelEnd) }} />
      <div className="abs" style={{ left: '38vw', top: '28vh', width: '24vw', height: '24vw', borderRadius: '50%', background: `radial-gradient(circle, ${KIDS_COLORS.yellow} 0%, ${KIDS_COLORS.amber} 45%, transparent 70%)`, ...anim('zcw-burst', beats.payoffEnd - beats.levelEnd, beats.levelEnd) }} />
    </>
  )
}

/** Creator storyline: ignite → boot (scan/grid/title) → build → compile → ship. */
function creatorTree(ctx: TreeCtx): ReactNode {
  const { beats, prof, anim, flying, C, CY } = ctx
  return (
    <>
      <div className="abs" style={{ left: 0, right: 0, height: 2, top: 0, background: `linear-gradient(90deg, transparent, ${CREATOR_COLORS.cyan}, transparent)`, ...anim('zcw-scan', beats.bootEnd, 0) }} />
      <div className="abs" style={{ left: '-30%', right: '-30%', top: '55%', height: '90%', transformOrigin: 'center top', background: `repeating-linear-gradient(90deg, ${CREATOR_COLORS.cyan}22 0 2px, transparent 2px 60px), repeating-linear-gradient(0deg, ${CREATOR_COLORS.violet}22 0 2px, transparent 2px 48px)`, ...anim('zcw-grid', beats.bootEnd, 0) }} />
      <div className="abs" style={{ left: C, top: CY, width: '30vw', height: '30vw', marginLeft: '-15vw', marginTop: '-15vw', border: `2px solid ${CREATOR_COLORS.cyan}`, borderRadius: '1vw', background: '#0B120Fcc', opacity: 0, ...anim('zcw-ignite', beats.igniteEnd, 0) }} />
      <div className="abs" style={{ left: '50%', top: '12vh', transform: 'translateX(-50%)', fontFamily: 'monospace', fontSize: '3.2vw', fontWeight: 700, color: CREATOR_COLORS.cyan, opacity: 0, ...anim('zcw-type', beats.bootEnd, 0) }}>Enter the Hub</div>
      {flying(3, 5, beats.bootEnd, beats.buildEnd, (i) => (
        <div style={{ width: '17vw', height: '11vw', border: `1.5px solid ${[CREATOR_COLORS.cyan, CREATOR_COLORS.violet, CREATOR_COLORS.green][i]}`, borderRadius: '0.6vw', background: '#0B120Fdd', ...anim('zcw-snap', 0.55, beats.bootEnd + ((i + 1) * (beats.buildEnd - beats.bootEnd)) / 4) }}>
          <div style={{ fontFamily: 'monospace', fontSize: '0.9vw', color: '#9fe', padding: '0.5vw' }}>{['template.ui', 'prompt.txt', 'automation.js'][i]}</div>
        </div>
      ))}
      {flying(3, 11, beats.buildEnd * 0.5, beats.compileEnd * 0.8, (i) => (
        <img src={PRODUCT_ART.creator[i]} alt="" width={140} height={140} style={{ width: '13vw', height: '13vw', objectFit: 'cover', borderRadius: '1.2vw', border: `2px solid ${CREATOR_COLORS.gold}` }} />
      ))}
      {Array.from({ length: Math.max(3, Math.round(5 * prof.particleScale)) }, (_, i) => (
        <div key={i} className="abs" style={{ left: `${8 + i * 19}vw`, top: 0, width: '3vw', height: '120%', overflow: 'hidden', opacity: 0.5 }}>
          <div style={{ fontFamily: 'monospace', color: i % 2 ? CREATOR_COLORS.green : CREATOR_COLORS.cyan, fontSize: '1.1vw', lineHeight: 1.5, ...anim('zcw-rain', 1.6 + rnd(i, 7), i * 0.3, { timing: 'linear', iter: 'infinite' }) }}>
            {Array.from({ length: 24 }, (_, j) => (j % 5 === 0 ? '01' : '›_')).join(' ')}
          </div>
        </div>
      ))}
      <div className="abs" style={{ left: '42vw', top: '30vh', width: '16vw', height: '16vw', borderRadius: '50%', border: `1vw solid ${CREATOR_COLORS.cyan}33`, borderTopColor: CREATOR_COLORS.cyan, ...anim('zcw-spin', beats.compileEnd - beats.buildEnd, beats.buildEnd) }} />
      {['25%', '50%', '100%'].map((label, i) => (
        <div key={label} className="abs" style={{ left: '60vw', top: `${33 + i * 6}vh`, fontFamily: 'monospace', fontSize: '2vw', color: CREATOR_COLORS.gold, opacity: 0, ...anim('zcw-win', 0.3, beats.buildEnd + ((i + 1) * (beats.compileEnd - beats.buildEnd)) / 3) }}>{label}</div>
      ))}
      <div className="abs" style={{ left: '46vw', top: '36vh', width: '8vw', height: '8vw', borderRadius: '50%', border: `0.4vw solid ${CREATOR_COLORS.green}`, ...anim('zcw-ring', beats.wipeStart - beats.compileEnd, beats.compileEnd) }} />
      {[CREATOR_COLORS.cyan, CREATOR_COLORS.magenta, CREATOR_COLORS.gold].map((c, i) => (
        <div key={c} className="abs" style={{ left: `${30 + i * 18}vw`, top: 0, width: '1vw', height: '100%', transformOrigin: 'top', background: `linear-gradient(180deg, ${c}, transparent)`, opacity: 0, ...anim('zcw-beam', beats.wipeStart - beats.compileEnd, beats.compileEnd + i * 0.1) }} />
      ))}
      <div className="abs inset-0" style={{ background: `radial-gradient(circle at 50% 50%, ${CREATOR_COLORS.cyan}, transparent 55%)`, ...anim('zcw-flash', beats.wipeStart - beats.compileEnd, beats.compileEnd) }} />
    </>
  )
}

export default function ReducedCpuStage(props: ChoreoProps): JSX.Element {
  const { zone, profile, totalMs, heroRect, onPhase } = props
  const prof = MOTION_PROFILES[profile]
  const scope = useMemo(() => `zcw-${++seq}`, [])
  const beats = useMemo(() => scaleBeats(zone === 'kids' ? KIDS_BEATS : CREATOR_BEATS, totalMs), [zone, totalMs])
  const css = useMemo(() => buildCss(scope, zone, prof.flashPeak), [scope, zone, prof.flashPeak])

  useEffect(() => {
    onPhase('playing')
    props.hooks.startClock()
  }, [onPhase])

  // Hero ghost at the measured gateway rectangle (viewport-centre fallback).
  const vw = typeof window === 'undefined' ? 1 : window.innerWidth
  const vh = typeof window === 'undefined' ? 1 : window.innerHeight
  const cx = heroRect ? ((heroRect.x + heroRect.width / 2) / vw) * 100 : 50
  const cy = heroRect ? ((heroRect.y + heroRect.height / 2) / vh) * 100 : 50
  const C = `${cx.toFixed(1)}vw`
  const CY = `${cy.toFixed(1)}vh`
  const stretch = 1 / prof.tempoScale
  const total = totalMs / 1000

  /** Single animation — delays/durations derived from the scaled beats. */
  const anim = (name: string, dur: number, delay: number, opts?: { timing?: string; iter?: string }): CSSProperties => ({
    animation: `${name} ${(dur * stretch).toFixed(2)}s ${opts?.timing ?? 'ease-out'} ${(delay * stretch).toFixed(2)}s ${opts?.iter ?? ''} both`.replace(/\s+/g, ' '),
  })
  /** Fly-in then gentle bob (the "variable reward" idle). */
  const anim2 = (n1: string, d1: number, del1: number, n2: string, d2: number, del2: number): CSSProperties => ({
    animation: `${n1} ${(d1 * stretch).toFixed(2)}s ease-out ${(del1 * stretch).toFixed(2)}s both, ${n2} ${(d2 * stretch).toFixed(2)}s ease-in-out ${(del2 * stretch).toFixed(2)}s infinite alternate`,
  })
  const flying = (n: number, salt: number, delayA: number, delayB: number, render: (i: number) => ReactNode) =>
    Array.from({ length: n }, (_, i) => {
      const dur = 1.1 + rnd(i, salt + 4) * 0.9
      const delay = delayA + (i / Math.max(1, n)) * (delayB - delayA)
      return (
        <div key={i} className="abs" style={{ ...floatVars(i, salt, C, CY), ...anim2('zcw-in', dur, delay, 'zcw-bob', 2.4 + rnd(i, salt + 5), delay + dur) }}>
          {render(i)}
        </div>
      )
    })

  return (
    <div className={scope}>
      <style>{css}</style>
      {zone === 'kids' ? kidsTree({ beats, prof, anim, anim2, flying, C, CY }) : creatorTree({ beats, prof, anim, anim2, flying, C, CY })}
      <div className="abs wipe inset-0" style={{ opacity: 0, ...anim('zcw-wipe', Math.max(0.3, total - beats.wipeStart), beats.wipeStart) }} />
    </div>
  )
}
