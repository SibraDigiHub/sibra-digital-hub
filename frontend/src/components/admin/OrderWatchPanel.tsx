'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — T-V Feature C: protected-watch controls inside the
// order detail drawer. Shows the grant state (expiry, lock,
// sessions, networks) and lets the owner revoke / unlock /
// extend / renew, plus "Preview as buyer" (30-min link).
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2, LockOpen, RefreshCcw, Timer, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface WatchStatus {
  exists: boolean
  expiresAt: string | null
  revokedAt: string | null
  lockedAt: string | null
  lockReason: string | null
  maxConcurrent: number | null
  activeSessions: number
  networks24h: number
  preview: boolean
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function OrderWatchPanel({ orderId }: { orderId: string }) {
  const { toast } = useToast()
  const [status, setStatus] = useState<WatchStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/orders/${orderId}/watch`)
      const data = (await res.json().catch(() => null)) as { watch?: WatchStatus } | null
      setStatus(data?.watch ?? null)
    } catch {
      setStatus(null)
    }
  }, [orderId])

  useEffect(() => {
    // Deferred boot-fetch (keeps the effect body free of sync state updates)
    const t = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [load])

  const act = async (action: 'revoke' | 'unlock' | 'extend' | 'renew', success: string) => {
    setBusy(true)
    try {
      const res = await adminFetch(`/api/admin/orders/${orderId}/watch`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Action failed')
      toast({ title: success })
      await load()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Action failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const preview = async () => {
    setPreviewLoading(true)
    try {
      const res = await adminFetch(`/api/admin/orders/${orderId}/watch-preview`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { token?: string; error?: string } | null
      if (!res.ok || !data?.token) throw new Error(data?.error ?? 'Preview link failed')
      window.open(`/#/watch/${data.token}`, '_blank', 'noopener,noreferrer')
      toast({ title: 'Preview link opened (valid 30 minutes)' })
      await load()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Preview failed', variant: 'destructive' })
    } finally {
      setPreviewLoading(false)
    }
  }

  if (!status) return null

  const expired = status.expiresAt ? new Date(status.expiresAt) < new Date() : false

  return (
    <section className="rounded-2xl border border-cyan-400/25 bg-cyan-500/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="font-cinzel text-xs uppercase tracking-widest text-cyan-300">Protected watch link</h4>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] text-[#9AA89E]" onClick={() => void load()}>
          <RefreshCcw className="size-3" aria-hidden="true" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-white/[0.04] p-2">
          <p className="text-[10px] uppercase tracking-wider text-[#9AA89E]">Expires</p>
          <p className={`font-semibold ${expired ? 'text-amber-300' : 'text-[#F5F8F6]'}`}>{fmt(status.expiresAt)}</p>
        </div>
        <div className="rounded-lg bg-white/[0.04] p-2">
          <p className="text-[10px] uppercase tracking-wider text-[#9AA89E]">Watching now</p>
          <p className="font-semibold text-[#F5F8F6]">
            {status.activeSessions}/{status.maxConcurrent ?? 2}
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.04] p-2">
          <p className="text-[10px] uppercase tracking-wider text-[#9AA89E]">Networks 24h</p>
          <p className={`font-semibold ${status.networks24h > 4 ? 'text-red-300' : 'text-[#F5F8F6]'}`}>
            {status.networks24h}/4
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.04] p-2">
          <p className="text-[10px] uppercase tracking-wider text-[#9AA89E]">State</p>
          <p className={`font-semibold ${status.lockedAt || status.revokedAt ? 'text-red-300' : 'text-emerald-300'}`}>
            {status.revokedAt ? 'Revoked' : status.lockedAt ? 'Locked' : expired ? 'Expired' : 'Active'}
          </p>
        </div>
      </div>

      {status.lockReason && <p className="mt-2 text-[11px] text-red-300">Lock reason: {status.lockReason}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={busy}
          onClick={() => void act('extend', 'Access extended +24h')}
        >
          <Timer className="size-3.5" aria-hidden="true" /> Extend +24h
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={busy}
          onClick={() => void act('renew', 'Access renewed (48h from now)')}
        >
          <RefreshCcw className="size-3.5" aria-hidden="true" /> Renew 48h
        </Button>
        {status.lockedAt || status.revokedAt ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs hover:border-emerald-500/50 hover:text-emerald-300"
            disabled={busy}
            onClick={() => void act('unlock', 'Link unlocked and restored')}
          >
            <LockOpen className="size-3.5" aria-hidden="true" /> Unlock
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs hover:border-red-500/50 hover:text-red-300"
            disabled={busy}
            onClick={() => void act('revoke', 'Watch access revoked')}
          >
            <Ban className="size-3.5" aria-hidden="true" /> Revoke
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs hover:border-cyan-500/50 hover:text-cyan-300"
          disabled={previewLoading}
          onClick={() => void preview()}
        >
          {previewLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
          Preview as buyer
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#7d8b93]">
        Preview opens a 30-minute link for you and replaces the buyer&apos;s current link on this order —
        click <span className="font-semibold text-[#9fe8c5]">Renew 48h</span> afterwards to restore the buyer&apos;s emailed link.
      </p>
    </section>
  )
}
