'use client'

// ═══════════════════════════════════════════════════════════
// "Exercise your rights" action card — prefilled mailto
// buttons (access / correction / erasure) + copy-email button
// with an aria-live confirmation.
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { Check, Copy, Mail, Scale } from 'lucide-react'

const ACTIONS: { subject: string; label: string; body: string }[] = [
  {
    subject: 'Data request — access',
    label: 'Get a copy of my data',
    body: 'Hello,\n\nI would like a copy of the data you hold about me.\n\nE-mail used on this site: \nOrder ID (if any): \n\nThank you,',
  },
  {
    subject: 'Data request — correction',
    label: 'Correct my data',
    body: 'Hello,\n\nSomething you hold about me is wrong. Please correct it.\n\nE-mail used on this site: \nWhat to correct: \n\nThank you,',
  },
  {
    subject: 'Data request — erasure',
    label: 'Erase my data',
    body: 'Hello,\n\nPlease erase the data you hold about me.\n\nE-mail used on this site: \nOrder ID (if any): \n\nThank you,',
  },
]

export default function LegalRightsCard({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the address is visible as text anyway */
    }
  }

  return (
    <aside
      aria-label="Exercise your privacy rights"
      className="glass rounded-3xl border-[rgba(229,184,66,0.35)] px-5 py-6 md:px-6"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/25 text-[#E5B842]"
          aria-hidden="true"
        >
          <Scale className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-playfair text-lg font-bold text-[#FAE8A7] md:text-xl">
            Exercise your rights
          </h2>
          <p className="text-xs text-[#9AA89E] md:text-sm">
            One tap opens your mail app with everything pre-filled.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <a
            key={a.subject}
            href={`mailto:${email}?subject=${encodeURIComponent(a.subject)}&body=${encodeURIComponent(a.body)}`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#E5B842]/40 bg-[#E5B842]/10 px-4 py-2 text-sm font-semibold text-[#FAE8A7] transition-colors hover:bg-[#E5B842]/20 focus-visible:outline-none"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            {a.label}
          </a>
        ))}
        <button
          type="button"
          onClick={copyEmail}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-[#F5F8F6] transition-colors hover:bg-white/10 focus-visible:outline-none"
        >
          {copied ? (
            <Check className="h-4 w-4 text-[#34D399]" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? 'Copied!' : 'Copy email address'}
        </button>
      </div>

      <span aria-live="polite" className="sr-only">
        {copied ? 'E-mail address copied to clipboard' : ''}
      </span>
    </aside>
  )
}
