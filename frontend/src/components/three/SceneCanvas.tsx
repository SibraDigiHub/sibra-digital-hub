'use client'

// ═══════════════════════════════════════════════════════════
// Persistent WebGL mood background (PRD §7.2) — mounted ONCE
// at app level, never unmounts. Instanced particles morph
// between the Kidosphere (warm shapes) and the Creator Hub
// (neon wireframes) driven by canvasMood 0..1. Weak devices
// get a pure CSS blob fallback instead.
// Heat discipline (T4): DPR 1 + a 30 fps manual advance loop on
// phones, a one-way thermal guard, and the render pauses while
// the tab is hidden, an opaque view covers the scene (admin) or
// the zone animation owns the screen.
// Loaded via next/dynamic { ssr: false } from the page shell.
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, advance } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '@/store/app-store'

const KIDS_A = new THREE.Color('#FFB347')
const KIDS_B = new THREE.Color('#FCE5CD')
const CREATOR_A = new THREE.Color('#00F0FF')
const CREATOR_B = new THREE.Color('#FF007F')

/** Thermal guard: sustained slow frames step DOWN once per session. */
const THERMAL_FRAME_MS = 24
const THERMAL_SUSTAIN_MS = 3000
const THERMAL_FACTOR = 0.55
const MOBILE_FPS = 30

interface Particle {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  s: number
  p1: number
  p2: number
}

function makeField(count: number, rMin = 3, rMax = 6): Particle[] {
  return Array.from({ length: count }, () => {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(rMin + Math.random() * (rMax - rMin))
    return {
      x: v.x,
      y: v.y,
      z: v.z,
      rx: 0.1 + Math.random() * 0.5,
      ry: 0.1 + Math.random() * 0.5,
      rz: (Math.random() - 0.5) * 0.4,
      s: 0.6 + Math.random() * 0.8,
      p1: Math.random() * Math.PI * 2,
      p2: Math.random() * Math.PI * 2,
    }
  })
}

/** Crossfade the page backdrop between warm pastel and obsidian-neon. */
function bgGradient(m: number): string {
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
  const rgba = (c: number[], a: number) => `rgba(${c.join(',')},${a.toFixed(3)})`
  const base = mix([255, 253, 248], [5, 7, 6], m)
  const glowA = mix([255, 179, 71], [0, 240, 255], m)
  const glowB = mix([252, 229, 205], [255, 0, 127], m)
  // Kids end softened (was 0.30 / 0.55) so the Zone A page reads
  // lighter and easier on the eyes; creator end unchanged.
  const alphaA = 0.18 + (0.16 - 0.18) * m
  const alphaB = 0.3 + (0.14 - 0.3) * m
  return `radial-gradient(900px 620px at 78% 18%, ${rgba(glowA, alphaA)}, transparent 65%), radial-gradient(760px 560px at 14% 84%, ${rgba(glowB, alphaB)}, transparent 62%), rgb(${base.join(',')})`
}

function MoodScene({ mood, thermal }: { mood: number; thermal: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const kidsMesh = useRef<THREE.InstancedMesh>(null)
  const wireMesh = useRef<THREE.InstancedMesh>(null)
  const moodRef = useRef(0.5)
  const pointer = useRef({ x: 0, y: 0 })
  const capRef = useRef(-1)

  const isMobile = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
    [],
  )
  const kidsField = useMemo(() => makeField(isMobile ? 200 : 600), [isMobile])
  const wireField = useMemo(() => makeField(isMobile ? 40 : 120, 2.5, 5.5), [isMobile])

  const kidsGeo = useMemo(() => new THREE.IcosahedronGeometry(0.08, 0), [])
  const kidsMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
    [],
  )
  const wireGeo = useMemo(() => new THREE.BoxGeometry(0.34, 0.34, 0.34), [])
  const wireMat = useMemo(
    () => new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.4, depthWrite: false }),
    [],
  )

  useEffect(
    () => () => {
      kidsGeo.dispose()
      kidsMat.dispose()
      wireGeo.dispose()
      wireMat.dispose()
    },
    [kidsGeo, kidsMat, wireGeo, wireMat],
  )

  // Mouse parallax target (normalised −1..1)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state, dt) => {
    const km = kidsMesh.current
    const wm = wireMesh.current
    if (!km || !wm) return
    const kidsMat = km.material as THREE.MeshBasicMaterial
    const wireMat = wm.material as THREE.MeshBasicMaterial
    const t = state.clock.elapsedTime
    moodRef.current = THREE.MathUtils.damp(moodRef.current, mood, 3, dt)
    const m = moodRef.current
    const kidsW = 1 - m

    // Thermal guard (one-way): cap the instance counts once.
    const cap = Math.floor(kidsField.length * thermal.current)
    if (cap !== capRef.current) {
      capRef.current = cap
      km.count = cap
      wm.count = Math.floor(wireField.length * thermal.current)
    }

    // Colour shimmer lerping between each zone's pair
    const phase = 0.5 + 0.5 * Math.sin(t * 0.35)
    kidsMat.color.lerpColors(KIDS_A, KIDS_B, phase)
    wireMat.color.lerpColors(CREATOR_A, CREATOR_B, 1 - phase)
    kidsMat.opacity = 0.9 * kidsW
    wireMat.opacity = 0.4 * m
    if (kidsMesh.current) kidsMesh.current.scale.setScalar(0.55 + 0.45 * kidsW)
    if (wireMesh.current) wireMesh.current.scale.setScalar(0.55 + 0.45 * m)

    const spin = (mesh: THREE.InstancedMesh | null, field: Particle[], weight: number) => {
      // Layers whose weight ~0 are invisible — skip all matrix writes.
      if (!mesh || weight <= 0.001) return
      for (let i = 0; i < mesh.count; i++) {
        const p = field[i]
        dummy.position.set(
          p.x + Math.sin(t * 0.6 + p.p1) * 0.18,
          p.y + Math.sin(t * 0.5 + p.p2) * 0.22,
          p.z + Math.cos(t * 0.4 + p.p1) * 0.18,
        )
        dummy.rotation.set(t * p.rx, t * p.ry, t * p.rz)
        dummy.scale.setScalar(p.s)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    spin(kidsMesh.current, kidsField, kidsW)
    spin(wireMesh.current, wireField, m)

    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, pointer.current.x * 0.25, 2.5, dt)
      group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, -pointer.current.y * 0.18, 2.5, dt)
    }
  })

  return (
    <group ref={group}>
      <instancedMesh ref={kidsMesh} args={[kidsGeo, kidsMat, kidsField.length]} frustumCulled={false} />
      <instancedMesh ref={wireMesh} args={[wireGeo, wireMat, wireField.length]} frustumCulled={false} />
    </group>
  )
}

export default function SceneCanvas() {
  const mood = useAppStore((s) => s.canvasMood)
  const scenePaused = useAppStore((s) => s.scenePaused)
  const view = useAppStore((s) => s.view)
  const [mode, setMode] = useState<'css' | 'webgl'>('css')
  const [mobile, setMobile] = useState(false)
  const [hidden, setHidden] = useState(false)
  const thermal = useRef(1) // one-way instance-count factor
  const bgRef = useRef<HTMLDivElement>(null)
  // The opaque admin console covers the scene completely.
  const covered = scenePaused || hidden || view === 'admin' || view === 'admin-reset'

  // Capability check — CPU cores + WebGL context probe (kept as is;
  // it may give weak PCs the CSS blobs — a capability, not a setting).
  useEffect(() => {
    const id = window.setTimeout(() => {
      setMobile(window.matchMedia('(max-width: 768px)').matches)
      let ok = (navigator.hardwareConcurrency ?? 4) >= 4
      if (ok) {
        try {
          const c = document.createElement('canvas')
          ok = !!(c.getContext('webgl2') || c.getContext('webgl'))
        } catch {
          ok = false
        }
      }
      setMode(ok ? 'webgl' : 'css')
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  // Pause rendering when the tab is hidden
  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Damped CSS gradient backdrop following mood (no re-render churn);
  // the loop stops itself once the mood has converged.
  useEffect(() => {
    let raf = 0
    let cur = mood
    const step = () => {
      cur += (mood - cur) * 0.08
      if (bgRef.current) bgRef.current.style.background = bgGradient(cur)
      if (Math.abs(mood - cur) > 0.002) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [mood])

  // Mobile: manual 30 fps advance loop with the thermal guard
  // (visually near-identical for the slow ambient morph, half the work).
  useEffect(() => {
    if (!mobile || mode !== 'webgl' || covered) return
    let raf = 0
    let last = 0
    let slowSince = 0
    let stepped = false
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const interval = 1000 / MOBILE_FPS
      if (now - last < interval - 1) return
      const dt = now - last
      last = now
      if (!stepped) {
        if (dt > THERMAL_FRAME_MS * 1.5) {
          if (!slowSince) slowSince = now
          else if (now - slowSince > THERMAL_SUSTAIN_MS) {
            stepped = true
            thermal.current = THERMAL_FACTOR
          }
        } else {
          slowSince = 0
        }
      }
      // advance() expects SECONDS in frameloop='never' mode — r3f assigns
      // the timestamp straight to clock.elapsedTime (a seconds-based THREE.Clock
      // field). Passing raw rAF ms ran every t-driven motion (the kids shapes +
      // creator wireframes) 1000× too fast. keep local dt (ms) for the guard.
      advance(now / 1000)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      slowSince = 0
    }
  }, [mobile, mode, covered])

  return (
    <>
      <div
        ref={bgRef}
        aria-hidden="true"
        className="fixed inset-0 -z-10"
        style={{ background: bgGradient(mood) }}
      />
      {mode === 'webgl' ? (
        <Canvas
          dpr={mobile ? 1 : [1, 1.5]}
          frameloop={covered ? 'never' : mobile ? 'never' : 'always'}
          gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 0, 8], fov: 60 }}
          style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
        >
          <MoodScene mood={mood} thermal={thermal} />
        </Canvas>
      ) : (
        <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden">
          <div
            className="blob left-[-10%] top-[8%] h-72 w-72 md:h-[28rem] md:w-[28rem]"
            style={{ background: 'radial-gradient(circle, #FFB347, transparent 70%)', opacity: 0.35 - 0.1 * mood }}
          />
          <div
            className="blob bottom-[6%] right-[-8%] h-72 w-72 md:h-[26rem] md:w-[26rem]"
            style={{ background: 'radial-gradient(circle, #00F0FF 20%, #FF007F 70%, transparent 78%)', opacity: 0.2 + 0.35 * mood }}
          />
        </div>
      )}
    </>
  )
}
