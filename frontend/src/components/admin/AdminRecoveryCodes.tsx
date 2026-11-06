'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — one-time recovery-code display (T4-b §5.11).
// 10 single-use codes, shown exactly once: Copy + Download .txt
// + a store-them-offline warning. Used by first-time enrollment
// and by "regenerate recovery codes" in the Security section.
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { Check, Copy, Download, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface AdminRecoveryCodesProps {
  codes: string[]
  onDone: () => void
  doneLabel?: string
}

export function downloadRecoveryCodes(codes: string[]): void {
  const text = [
    'Sibra Digital Hub — admin recovery codes',
    `Generated ${new Date().toISOString()}`,
    '',
    ...codes,
    '',
    'Each code works ONCE as a second factor. Store this file offline (password manager / printed). Regenerating invalidates older codes.',
  ].join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'sibra-admin-recovery-codes.txt'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function AdminRecoveryCodes({ codes, onDone, doneLabel = 'Continue' }: AdminRecoveryCodesProps) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      toast({ title: 'Recovery codes copied' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed — select the codes manually', variant: 'destructive' })
    }
  }

  return (
    <div className="text-left">
      <div
        className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
        role="status"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          These {codes.length} recovery codes are shown <strong>only once</strong>. Each works a single time as your
          second factor. Store them offline now — this screen cannot be shown again.
        </span>
      </div>

      <ul className="nice-scroll mt-3 grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c} className="select-all font-mono text-sm tracking-wider text-[#F5F8F6]">
            {c}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-10" onClick={() => void copyAll()}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          Copy all
        </Button>
        <Button type="button" variant="outline" className="h-10" onClick={() => downloadRecoveryCodes(codes)}>
          <Download className="size-4" aria-hidden="true" />
          Download .txt
        </Button>
        <Button
          type="button"
          onClick={onDone}
          className="ml-auto h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
        >
          {doneLabel}
        </Button>
      </div>
    </div>
  )
}
