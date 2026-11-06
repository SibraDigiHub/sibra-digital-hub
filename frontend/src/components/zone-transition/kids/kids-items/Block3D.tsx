'use client'

import type { JSX } from 'react'

// Block3D — a real 6-faced CSS cube (B4 treasure rain): glossy
// alphabet block showing a letter/digit on its front + back.
// Gradients only (no blur/box-shadow animation); the parent
// timeline animates the wrapper, so this component is static.

const FACES = [
  'translateZ(calc(var(--kb-s) / 2))',
  'rotateY(180deg) translateZ(calc(var(--kb-s) / 2))',
  'rotateY(90deg) translateZ(calc(var(--kb-s) / 2))',
  'rotateY(-90deg) translateZ(calc(var(--kb-s) / 2))',
  'rotateX(90deg) translateZ(calc(var(--kb-s) / 2))',
  'rotateX(-90deg) translateZ(calc(var(--kb-s) / 2))',
] as const

export default function Block3D({ glyph, tint }: { glyph: string; tint: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        // --kb-s drives both the face size and the half-depth translateZ
        ['--kb-s' as string]: '9vmin',
        width: '9vmin',
        height: '9vmin',
        position: 'relative',
        transformStyle: 'preserve-3d',
      }}
    >
      {FACES.map((transform, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '1.3vmin',
            background: `linear-gradient(150deg, ${tint} 0%, #FFF7E0 52%, ${tint} 100%)`,
            color: '#5B4A21',
            fontSize: '4.4vmin',
            fontWeight: 800,
            transform,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {i < 2 ? glyph : ''}
        </div>
      ))}
    </div>
  )
}
