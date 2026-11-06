'use client'

// CodeRain2D — the ONE Canvas-2D layer of the creator run (B5/
// B6): a pooled Particles2D instance whose 'raindrop' kind is
// the code rain, reusing the same pool for ship-time sparks.
// Zero React state; the parent emits through a stable ref api.

import { useEffect, useRef, type JSX } from 'react'
import { Particles2D, type ParticleEmitOpts } from '../../stage/Particles2D'

export interface CodeRainApi {
  emit: (kind: number, count: number, opts?: ParticleEmitOpts) => void
  resize: () => void
}

export default function CodeRain2D({ max, fpsCap, apiRef }: { max: number; fpsCap: number; apiRef: { current: CodeRainApi | null } }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const particles = new Particles2D(canvas, { max, fpsCap })
    particles.resume()
    apiRef.current = {
      emit: (kind, count, opts) => particles.emit(kind, count, opts),
      resize: () => particles.resize(),
    }
    return () => {
      apiRef.current = null
      particles.dispose()
    }
  }, [max, fpsCap, apiRef])

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
}
