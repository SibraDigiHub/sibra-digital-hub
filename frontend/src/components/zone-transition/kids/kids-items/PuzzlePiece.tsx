'use client'

import type { JSX } from 'react'

// PuzzlePiece — a jigsaw piece (B4) drawn as one SVG path with a
// soft knob and a static white sheen ellipse for the gloss.

export default function PuzzlePiece({ tint }: { tint: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" style={{ width: '9vmin', height: '9vmin', overflow: 'visible' }}>
      <path
        d="M8 13h8a5 5 0 1 1 8 0h8v9a5 5 0 1 0 0 8v7H8z"
        fill={tint}
        stroke="rgba(91,74,33,0.4)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <ellipse cx="15" cy="20" rx="6" ry="4.5" fill="rgba(255,255,255,0.35)" />
    </svg>
  )
}
