'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — System (PRD v6.1 §11.8/§11.10): integrations health,
// JSON backup/export, and the audit trail of every admin edit.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Download, Info, Search, ShieldCheck, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'

interface SystemInfo {
  integrations: { database: boolean; razorpay: boolean; international: boolean; imagekit: boolean; resend: boolean; authSecrets: boolean }
  payments?: {
    razorpayMode: string
    internationalEnabled: boolean
    foreignCurrencies?: string[]
    lastWebhookAt: string | null
    lastWebhookGateway: string | null
    failedEmailsToday: number
  }
  cronHeartbeats?: { reconcilePayments: string | null; retryEmails: string | null }
  demoMode: boolean
  counters: { archivedProducts: number; pendingOrders: number; failedEmails: number; failedPayments: number; events24h: number }
  alerts: { level: 'info' | 'warn'; text: string }[]
}

interface AuditRow {
  id: string
  action: string
  entity: string
  entityId: string | null
  label: string | null
  diff: string | null
  ip: string | null
  createdAt: string
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** P4: a payments cron silent for >30 min must be visible to the owner. */
const HEARTBEAT_WARN_MS = 30 * 60 * 1000
function heartbeatStale(iso: string | null): boolean {
  if (!iso) return false // never ran — a fresh deployment, not a dead one
  const t = new Date(iso).getTime()
  return !isNaN(t) && Date.now() - t > HEARTBEAT_WARN_MS
}

export default function AdminSystem() {
  const { toast } = useToast()
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [logs, setLogs] = useState<AuditRow[] | null>(null)
  const [q, setQ] = useState('')

  const fetchInfo = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/system')
      const d = (await res.json().catch(() => null)) as (SystemInfo & { error?: string }) | null
      if (!res.ok || !d) throw new Error(d?.error ?? 'Failed to load system info')
      setInfo(d)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load system info', variant: 'destructive' })
    }
  }, [toast])

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      const res = await adminFetch(`/api/admin/audit?${params.toString()}`)
      const d = (await res.json().catch(() => null)) as { logs?: AuditRow[]; error?: string } | null
      if (!res.ok || !d) throw new Error(d?.error ?? 'Failed to load audit log')
      setLogs(d.logs ?? [])
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load audit log', variant: 'destructive' })
    }
  }, [q, toast])

  useEffect(() => {
    void fetchInfo()
  }, [fetchInfo])

  useEffect(() => {
    const t = setTimeout(() => void fetchLogs(), 250)
    return () => clearTimeout(t)
  }, [fetchLogs])

  function exportJson(type: string) {
    // Direct browser download — session cookie authorises it
    const a = document.createElement('a')
    a.href = `/api/admin/export?type=${encodeURIComponent(type)}`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast({ title: `Exporting ${type}…`, description: 'The JSON backup is downloading.' })
  }

  const integrations = info?.integrations
  const integrationRows = integrations
    ? [
        { key: 'database', label: 'Database (PostgreSQL)', ok: integrations.database, hint: 'Products, orders, events.' },
        { key: 'razorpay', label: 'Razorpay (India, INR)', ok: integrations.razorpay, hint: `RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET — demo mode until set.${info?.payments ? ` Mode: ${info.payments.razorpayMode}.` : ''}` },
        { key: 'international', label: 'International checkout (Razorpay)', ok: integrations.international, hint: `INTERNATIONAL_CHECKOUT_ENABLED=true after Razorpay International is activated in the Dashboard.${info?.payments ? ` Currencies: ${(info.payments.foreignCurrencies ?? []).join(', ') || '—'}.` : ''}` },
        { key: 'imagekit', label: 'ImageKit (CDN uploads)', ok: integrations.imagekit, hint: 'IMAGEKIT_PRIVATE_KEY + NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT.' },
        { key: 'resend', label: 'Resend (delivery email)', ok: integrations.resend, hint: 'RESEND_API_KEY — emails are logged, not sent, until set.' },
        { key: 'authSecrets', label: 'Auth secrets', ok: integrations.authSecrets, hint: 'ENCRYPTION_KEY + SESSION_PEPPER (T4 admin auth).' },
      ]
    : []

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-cinzel text-xl text-[#E5B842]">System</h2>
        <p className="text-sm text-[#9AA89E]">Integrations health, data backups and the full admin audit trail.</p>
      </div>

      {/* Alerts */}
      {info && info.alerts.length > 0 && (
        <ul className="space-y-2">
          {info.alerts.map((a, i) => (
            <li
              key={i}
              className={
                a.level === 'warn'
                  ? 'flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200'
                  : 'flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-[#C9D2CB]'
              }
            >
              {a.level === 'warn' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              {a.text}
            </li>
          ))}
        </ul>
      )}

      {/* Integrations */}
      <section className="glass rounded-2xl p-4 md:p-5">
        <h3 className="mb-3 flex items-center gap-2 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">
          <ShieldCheck className="size-4" aria-hidden="true" /> Integrations
        </h3>
        {!info ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {integrationRows.map((r) => (
              <li key={r.key} className="flex items-start gap-2.5 rounded-xl bg-white/[0.03] p-3">
                {r.ok ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-label={`${r.label} connected`} />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-[#9AA89E]" aria-label={`${r.label} not configured`} />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="truncate text-[11px] text-[#9AA89E]">{r.hint}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {info && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-[#9AA89E]">
            <Database className="size-3.5" aria-hidden="true" />
            {info.counters.events24h} events tracked (24h) · {info.counters.pendingOrders} pending · {info.counters.failedEmails} email failures ·{' '}
            {info.counters.archivedProducts} in trash
          </p>
        )}
      </section>

      {/* P4: cron heartbeats — the repair loop for lost webhooks / failed emails */}
      {info?.cronHeartbeats && (
        <section className="glass rounded-2xl p-4 md:p-5">
          <h3 className="mb-3 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Cron heartbeats</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="flex items-start gap-2.5 rounded-xl bg-white/[0.03] p-3">
              {heartbeatStale(info.cronHeartbeats.reconcilePayments) ? (
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" aria-label="Payments reconciliation cron is stale" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-label="Payments reconciliation cron healthy" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">Payments reconciliation</p>
                <p className={`truncate text-[11px] ${heartbeatStale(info.cronHeartbeats.reconcilePayments) ? 'text-amber-300' : 'text-[#9AA89E]'}`}>
                  {info.cronHeartbeats.reconcilePayments ? `Last success: ${fmtDate(info.cronHeartbeats.reconcilePayments)}` : 'Never ran — scheduler not configured?'}
                  {heartbeatStale(info.cronHeartbeats.reconcilePayments) ? ' · older than 30 min — check the scheduler (docs/DEPLOYMENT.md §14)' : ''}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2.5 rounded-xl bg-white/[0.03] p-3">
              {heartbeatStale(info.cronHeartbeats.retryEmails) ? (
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" aria-label="Email retry cron is stale" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-label="Email retry cron healthy" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">Delivery-email retries</p>
                <p className={`truncate text-[11px] ${heartbeatStale(info.cronHeartbeats.retryEmails) ? 'text-amber-300' : 'text-[#9AA89E]'}`}>
                  {info.cronHeartbeats.retryEmails ? `Last success: ${fmtDate(info.cronHeartbeats.retryEmails)}` : 'Never ran — scheduler not configured?'}
                  {heartbeatStale(info.cronHeartbeats.retryEmails) ? ' · older than 30 min — check the scheduler (docs/DEPLOYMENT.md §14)' : ''}
                </p>
              </div>
            </li>
          </ul>
        </section>
      )}

      {/* Export / backup */}
      <section className="glass rounded-2xl p-4 md:p-5">
        <h3 className="mb-3 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Backup &amp; export (JSON)</h3>
        <div className="flex flex-wrap gap-2">
          {(['products', 'orders', 'customers', 'settings', 'audit', 'all'] as const).map((t) => (
            <Button key={t} variant="outline" className="h-10 capitalize" onClick={() => exportJson(t)}>
              <Download className="size-4" aria-hidden="true" /> {t}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[#9AA89E]">
          Downloads are stripped of download-token material — safe backups only (PRD §11.10).
        </p>
      </section>

      {/* Audit log */}
      <section className="glass rounded-2xl p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Audit log</h3>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9AA89E]" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action / entity…" aria-label="Filter audit log" className="h-9 pl-9" />
          </div>
        </div>
        {!logs ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#9AA89E]">
            No admin actions recorded yet — every create/edit/delete shows up here.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto nice-scroll">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-[#9AA89E]">When</TableHead>
                  <TableHead className="text-[#9AA89E]">Action</TableHead>
                  <TableHead className="text-[#9AA89E]">Entity</TableHead>
                  <TableHead className="text-[#9AA89E]">Details</TableHead>
                  <TableHead className="text-[#9AA89E]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id} className="border-white/10">
                    <TableCell className="whitespace-nowrap text-xs text-[#9AA89E]">{fmtDate(l.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-[#E5B842]/30 bg-[#E5B842]/10 font-mono text-[11px] text-[#E5B842]">
                        {l.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs capitalize text-[#9AA89E]">{l.entity}</TableCell>
                    <TableCell className="max-w-[280px]">
                      <p className="truncate text-sm">{l.label ?? '—'}</p>
                      {l.diff && <p className="truncate font-mono text-[10px] text-[#9AA89E]">{l.diff}</p>}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-[#9AA89E]">{l.ip ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
