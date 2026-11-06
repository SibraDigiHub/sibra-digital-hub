'use client'

// ═══════════════════════════════════════════════════════════
// T-V Feature A — the "Ask a grown-up" gate (Kids zone only).
// A tiny friendly check before a child leaves our site for
// a social platform. Answer remembered for THIS BROWSER SESSION only
// (sessionStorage), Creator Hub never asks (brief §A).
// ═══════════════════════════════════════════════════════════

import { useCallback, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

const KEY = 'sdh_grownup_ok'

function makeQuestion(): { a: number; b: number; answer: number } {
  const a = 1 + Math.floor(Math.random() * 4) // 1..4
  const b = 1 + Math.floor(Math.random() * 5) // 1..5
  return { a, b, answer: a + b }
}

export function isGrownUpOk(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface GateProps {
  /** Called after the check passes — the parent then opens the link
   *  (form submit keeps the user-gesture context, so popups are allowed). */
  onPass: () => void
  /** What the child is about to open (button label context). */
  channelName: string
  /** Compact card variant for small popovers. */
  compact?: boolean
  className?: string
}

export default function GrownUpGate({ channelName, compact, className, onPass }: GateProps) {
  const [q, setQ] = useState(() => makeQuestion())
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (Number(value.trim()) === q.answer) {
        try {
          window.sessionStorage.setItem(KEY, '1')
        } catch {
          /* private mode — gate simply re-asks next time */
        }
        onPass() // direct form submit → still a user gesture → popup allowed
      } else {
        setError(true)
        setQ(makeQuestion())
        setValue('')
      }
    },
    [value, q, onPass],
  )

  return (
    <form
      onSubmit={submit}
      className={cn(
        'rounded-2xl border-2 border-[#FFB347]/60 bg-[#FFF8E7] p-4 text-left shadow-[0_10px_30px_rgba(255,179,71,0.25)]',
        compact && 'p-3',
        className,
      )}
      aria-label="Quick check before leaving for social media"
    >
      <p className={cn('flex items-center gap-1.5 font-baloo font-bold text-[#7A4A00]', compact ? 'text-xs' : 'text-sm')}>
        <ShieldCheck className="size-4 shrink-0 text-[#E58E1A]" aria-hidden="true" />
        One quick check, please!
      </p>
      <p className={cn('mt-1 text-[#7A4A00]/90', compact ? 'text-[11px]' : 'text-xs')}>
        Are you allowed to visit social media? Solve this to continue to <strong>{channelName}</strong>:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={cn(
            'grid place-items-center rounded-lg bg-white px-2.5 py-1.5 font-mono font-bold text-[#7A4A00]',
            compact ? 'text-xs' : 'text-sm',
          )}
          aria-label={`What is ${q.a} plus ${q.b}?`}
        >
          {q.a} + {q.b} = ?
        </span>
        <input
          type="input"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))
            setError(false)
          }}
          aria-label="Your answer"
          aria-invalid={error}
          className={cn(
            'h-10 w-16 rounded-lg border-2 border-[#FFB347]/70 bg-white text-center font-bold text-[#7A4A00] outline-none focus:border-[#E58E1A]',
            compact && 'h-9 w-14 text-sm',
          )}
        />
        <button
          type="submit"
          className={cn(
            'grid h-10 min-w-[44px] place-items-center rounded-full bg-gradient-to-r from-[#FFB347] to-[#E58E1A] px-4 font-baloo text-sm font-extrabold text-white shadow transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E58E1A]',
            compact && 'px-3 text-xs',
          )}
        >
          Go →
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] font-semibold text-red-600">
          Oops — try again! Ask a grown-up if you&apos;re stuck. 🙂
        </p>
      )}
    </form>
  )
}
