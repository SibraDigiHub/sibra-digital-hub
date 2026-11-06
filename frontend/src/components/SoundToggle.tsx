'use client'

// ═══════════════════════════════════════════════════════════
// Round glass sound toggle — persists to localStorage and
// plays a sparkle confirmation when switching ON.
// ═══════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { playFx } from '@/lib/sound-fx'

export default function SoundToggle() {
  const soundOn = useAppStore((s) => s.soundOn)
  const setSoundOn = useAppStore((s) => s.setSoundOn)

  // Read persisted preference once on mount. Sound is ON by default;
  // only an explicit saved mute ('0', or legacy 'off') silences it.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('sdh_sound')
      setSoundOn(stored !== '0' && stored !== 'off')
    } catch {
      /* storage unavailable — keep default */
    }
  }, [setSoundOn])

  const toggle = () => {
    const next = !soundOn
    setSoundOn(next)
    try {
      window.localStorage.setItem('sdh_sound', next ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (next) playFx('sparkle')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle sound effects"
      aria-pressed={soundOn}
      className="glass relative grid h-9 w-9 place-items-center rounded-full text-[#E5B842] transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none after:absolute after:-inset-1.5 after:rounded-full after:content-['']"
    >
      {soundOn ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
    </button>
  )
}
