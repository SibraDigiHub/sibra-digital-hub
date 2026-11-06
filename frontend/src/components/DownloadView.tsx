'use client'

// ═══════════════════════════════════════════════════════════
// Download view — token-gated delivery landing (SPA route
// #/download/[token]). The GET only VALIDATES (never consumes
// a download — email scanners/prefetchers hitting the emailed
// link are free); the buyer's Download click CLAIMS the slot
// via POST and then opens the private file. Friendly
// expired/invalid states.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, ShieldCheck, Clock, AlertTriangle, ArrowLeft, Mail, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; name: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }

export default function DownloadView() {
  const token = useAppStore((s) => s.downloadToken)
  const navigate = useAppStore((s) => s.navigate)
  const [state, setState] = useState<State>(() => (token ? { kind: 'loading' } : { kind: 'missing' }))
  const [claiming, setClaiming] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    void (async () => {
      try {
        // Validation GET — consumes nothing (the claim is the POST below).
        const res = await fetch(`/api/download/${token}?mode=json`)
        const data = await res.json()
        if (data.ok) setState({ kind: 'ready', name: data.name ?? null })
        else setState({ kind: 'error', message: data.error || 'This download link is not valid' })
      } catch {
        setState({ kind: 'error', message: 'Could not reach the server. Check your connection and retry.' })
      }
    })()
  }, [token])

  const claim = useCallback(async () => {
    if (!token || claiming) return
    setClaiming(true)
    try {
      // THE claim: one download slot per successful POST.
      const res = await fetch(`/api/download/${token}?mode=json`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (data?.ok && data.fileUrl) {
        window.open(data.fileUrl, '_blank', 'noopener,noreferrer')
      } else {
        setState({ kind: 'error', message: data?.error || 'This download link is not valid' })
      }
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Check your connection and retry.' })
    } finally {
      setClaiming(false)
    }
  }, [token, claiming])

  return (
    <div className="relative z-10 flex min-h-[80dvh] items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass w-full max-w-md rounded-3xl p-8 text-center"
      >
        {state.kind === 'loading' && (
          <>
            <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-[#e5b842]/30 border-t-[#e5b842]" />
            <h1 className="font-cinzel text-xl text-[#fae8a7]">Validating your secure link…</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">Checking token, expiry and download count.</p>
          </>
        )}

        {state.kind === 'ready' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <ShieldCheck className="h-8 w-8 text-emerald-400" />
            </div>
            <h1 className="font-cinzel text-2xl text-[#fae8a7]">You&apos;re all set! 🎉</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">
              {state.name ? (
                <>
                  Your file: <span className="font-semibold text-[#f5f8f6]">{state.name}</span>
                </>
              ) : (
                'Your paid file is ready to download.'
              )}
            </p>
            <Button
              onClick={() => void claim()}
              disabled={claiming}
              className="mt-6 h-12 w-full rounded-full bg-gradient-to-r from-[#e5b842] to-[#c9932a] text-base font-bold text-[#050706] hover:from-[#fae8a7] hover:to-[#e5b842]"
            >
              {claiming ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Preparing your file…
                </>
              ) : (
                <>
                  <Download className="mr-2 h-5 w-5" /> Download Now
                </>
              )}
            </Button>
            <div className="mt-5 space-y-1.5 text-xs text-[#9aa89e]">
              <p className="flex items-center justify-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Link valid 48 hours · 5 downloads max
              </p>
              <p className="flex items-center justify-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> This link was also emailed to you
              </p>
            </div>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h1 className="font-cinzel text-xl text-[#fae8a7]">Download unavailable</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">{state.message}</p>
            <Button
              variant="outline"
              className="mt-6 h-11 rounded-full border-[#e5b842]/40 text-[#fae8a7] hover:bg-[#e5b842]/10"
              onClick={() => navigate('legal', { legalPage: 'contact' })}
            >
              <Mail className="mr-2 h-4 w-4" /> Contact support
            </Button>
          </>
        )}

        {state.kind === 'missing' && (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h1 className="font-cinzel text-xl text-[#fae8a7]">No download token found</h1>
            <p className="mt-2 text-sm text-[#9aa89e]">Use the exact link from your delivery email.</p>
          </>
        )}

        <Button
          variant="ghost"
          className="mt-6 text-xs text-[#9aa89e] hover:text-[#fae8a7]"
          onClick={() => navigate('shop', {})}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to shop
        </Button>
      </motion.div>
    </div>
  )
}

function playSpark() {
  void import('@/lib/sound-fx').then(({ playFx }) => playFx('chime'))
}

