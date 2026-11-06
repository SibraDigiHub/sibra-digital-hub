'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Customers & Activity (PRD v6.1 §11.6): one profile
// per email — orders, lifetime value, downloads and a full
// browsing/purchase timeline, plus one-click DPDP data erasure.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import TablePagination, { TABLE_PAGE_SIZE } from '@/components/admin/TablePagination'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download,
  Eye,
  MousePointerClick,
  Search,
  ShoppingCart,
  Trash2,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import type { Order } from '@/types/marketplace'
import { cn } from '@/lib/utils'

interface CustomerSummary {
  email: string
  name: string
  totalOrders: number
  paidOrders: number
  lifetimeValueInr: number
  totalDownloads: number
  firstOrderAt: string | null
  lastOrderAt: string | null
  activityEvents: number
}

interface TimelineEvent {
  id: string
  type: string
  productId: string | null
  platform: string | null
  createdAt: string
  meta: string
}

interface Profile {
  email: string
  name: string
  orders: Order[]
  events: TimelineEvent[]
  stats: {
    totalOrders: number
    paidOrders: number
    lifetimeValueInr: number
    totalDownloads: number
    firstOrderAt: string | null
    lastOrderAt: string | null
  }
}

const STATUS_STYLES: Record<string, string> = {
  paid: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  pending: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  revoked: 'border-red-500/40 bg-red-500/15 text-red-300',
  refunded: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300',
  failed: 'border-white/20 bg-white/10 text-[#9AA89E]',
}

const EVENT_META: Record<string, { icon: typeof Eye; label: string; tone: string }> = {
  product_view: { icon: Eye, label: 'Viewed product', tone: 'text-sky-300' },
  buy_click: { icon: MousePointerClick, label: 'Clicked buy', tone: 'text-amber-300' },
  platform_click: { icon: MousePointerClick, label: 'Clicked store button', tone: 'text-amber-300' },
  checkout_started: { icon: ShoppingCart, label: 'Started checkout', tone: 'text-cyan-300' },
  order_paid: { icon: Wallet, label: 'Paid', tone: 'text-emerald-300' },
  download: { icon: Download, label: 'Downloaded file', tone: 'text-violet-300' },
  email_sent: { icon: Zap, label: 'Delivery email sent', tone: 'text-emerald-300' },
  email_resent: { icon: Zap, label: 'Email re-sent', tone: 'text-emerald-300' },
  search: { icon: Search, label: 'Searched', tone: 'text-[#9AA89E]' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminCustomers() {
  const { toast } = useToast()
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [erasureTarget, setErasureTarget] = useState<CustomerSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      const res = await adminFetch(`/api/admin/customers?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { customers?: CustomerSummary[]; error?: string } | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Failed to load customers')
      setCustomers(data.customers ?? [])
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load customers', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [q, toast])

  useEffect(() => {
    const t = setTimeout(() => void fetchCustomers(), 250)
    return () => clearTimeout(t)
  }, [fetchCustomers])

  async function openProfile(email: string) {
    setProfileLoading(true)
    setProfile(null)
    try {
      const res = await adminFetch(`/api/admin/customers/${encodeURIComponent(email)}`)
      const data = (await res.json().catch(() => null)) as (Profile & { error?: string }) | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Failed to load profile')
      setProfile(data)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load profile', variant: 'destructive' })
    } finally {
      setProfileLoading(false)
    }
  }

  async function confirmErasure() {
    if (!erasureTarget) return
    setBusy(true)
    try {
      const res = await adminFetch(`/api/admin/customers/${encodeURIComponent(erasureTarget.email)}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; ordersAnonymised?: number } | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Erasure failed')
      toast({
        title: 'Customer data erased',
        description: `${data.ordersAnonymised ?? 0} order row(s) anonymised · timeline removed (logged in Audit).`,
      })
      setErasureTarget(null)
      setProfile(null)
      await fetchCustomers()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Erasure failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const totals = useMemo(
    () => ({
      customers: customers.length,
      value: customers.reduce((s, c) => s + c.lifetimeValueInr, 0),
      paid: customers.reduce((s, c) => s + c.paidOrders, 0),
    }),
    [customers],
  )

  // Pagination (12 per page) — totals above always reflect the full list.
  const customerPageCount = Math.max(1, Math.ceil(customers.length / TABLE_PAGE_SIZE))
  const safeCustomerPage = Math.min(page, customerPageCount)
  const pagedCustomers = customers.slice(
    (safeCustomerPage - 1) * TABLE_PAGE_SIZE,
    safeCustomerPage * TABLE_PAGE_SIZE,
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-cinzel text-xl text-[#E5B842]">Customers &amp; Activity</h2>
          <p className="text-sm text-[#9AA89E]">One profile per email — orders, value, downloads and the full journey.</p>
        </div>
        <div className="flex gap-4 text-right text-xs text-[#9AA89E]">
          <span>
            <strong className="block text-lg text-[#F5F8F6]">{totals.customers}</strong> customers
          </span>
          <span>
            <strong className="block text-lg text-[#E5B842]">₹{totals.value.toLocaleString('en-IN')}</strong> lifetime value
          </span>
          <span>
            <strong className="block text-lg text-emerald-300">{totals.paid}</strong> paid orders
          </span>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9AA89E]" aria-hidden="true" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="Search by name or email…"
          aria-label="Search customers"
          className="h-10 pl-9"
        />
      </div>

      <div className="glass rounded-2xl p-4 md:p-5">
        {loading ? (
          <div className="space-y-2">
            {([0, 1, 2, 3] as const).map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="size-10 text-[#9AA89E]" aria-hidden="true" />
            <p className="font-medium">No customers yet</p>
            <p className="text-sm text-[#9AA89E]">Customer profiles appear automatically with the first ⚡ order.</p>
          </div>
        ) : (
          <>
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-[#9AA89E]">Customer</TableHead>
                  <TableHead className="text-[#9AA89E]">Orders</TableHead>
                  <TableHead className="text-[#9AA89E]">Paid</TableHead>
                  <TableHead className="text-[#9AA89E]">Lifetime value</TableHead>
                  <TableHead className="text-[#9AA89E]">Downloads</TableHead>
                  <TableHead className="text-[#9AA89E]">Events</TableHead>
                  <TableHead className="text-[#9AA89E]">Last order</TableHead>
                  <TableHead className="text-right text-[#9AA89E]">Profile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCustomers.map((c) => (
                  <TableRow key={c.email} className="border-white/10">
                    <TableCell>
                      <p className="max-w-[220px] truncate text-sm font-medium">{c.name}</p>
                      <p className="max-w-[220px] truncate text-xs text-[#9AA89E]">{c.email}</p>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.totalOrders}</TableCell>
                    <TableCell className="font-mono text-sm text-emerald-300">{c.paidOrders}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-semibold text-[#E5B842]">
                      ₹{c.lifetimeValueInr.toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.totalDownloads}</TableCell>
                    <TableCell className="font-mono text-sm text-[#9AA89E]">{c.activityEvents}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-[#9AA89E]">{fmtDate(c.lastOrderAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="h-9" onClick={() => void openProfile(c.email)}>
                        View journey
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {customers.length > TABLE_PAGE_SIZE && (
              <TablePagination
                page={safeCustomerPage}
                pageCount={customerPageCount}
                total={customers.length}
                onPageChange={setPage}
                label="customers"
              />
            )}
          </>
        )}
      </div>

      {/* ── Profile drawer ── */}
      {(profile || profileLoading) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Customer journey — ${profile?.name ?? ''}`}
          onClick={() => !profileLoading && setProfile(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0B0F0C] p-5 nice-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            {profileLoading || !profile ? (
              <div className="space-y-3">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-64 rounded-2xl" />
              </div>
            ) : (
              <div className="space-y-5">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-cinzel text-lg text-[#E5B842]">{profile.name}</h3>
                    <p className="truncate text-sm text-[#9AA89E]">{profile.email}</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setProfile(null)}>
                    Close
                  </Button>
                </header>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Orders', value: String(profile.stats.totalOrders) },
                    { label: 'Paid', value: String(profile.stats.paidOrders) },
                    { label: 'LTV', value: `₹${profile.stats.lifetimeValueInr.toLocaleString('en-IN')}` },
                    { label: 'Downloads', value: String(profile.stats.totalDownloads) },
                  ].map((s) => (
                    <div key={s.label} className="glass rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-[#F5F8F6]">{s.value}</p>
                      <p className="text-[11px] text-[#9AA89E]">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Orders */}
                <section>
                  <h4 className="mb-2 font-cinzel text-xs uppercase tracking-widest text-[#E5B842]">Orders</h4>
                  {profile.orders.length === 0 ? (
                    <p className="text-sm text-[#9AA89E]">No orders.</p>
                  ) : (
                    <ul className="space-y-2">
                      {profile.orders.map((o) => (
                        <li key={o.id} className="glass rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-sm font-medium">{o.product?.title ?? '—'}</p>
                            <Badge variant="outline" className={cn('shrink-0', STATUS_STYLES[o.status] ?? STATUS_STYLES.failed)}>
                              {o.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-[#9AA89E]">
                            ₹{o.amountInr.toLocaleString('en-IN')} · {fmtDate(o.createdAt)} · {o.downloadCount} download(s)
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Activity timeline */}
                <section>
                  <h4 className="mb-2 font-cinzel text-xs uppercase tracking-widest text-[#E5B842]">Activity timeline</h4>
                  {profile.events.length === 0 ? (
                    <p className="text-sm text-[#9AA89E]">No tracked events for this customer yet.</p>
                  ) : (
                    <ol className="max-h-80 space-y-1.5 overflow-y-auto pr-1 nice-scroll" aria-label="Customer activity timeline">
                      {profile.events.map((ev) => {
                        const meta = EVENT_META[ev.type] ?? { icon: Eye, label: ev.type, tone: 'text-[#9AA89E]' }
                        const Icon = meta.icon
                        let extra = ''
                        try {
                          const m = JSON.parse(ev.meta || '{}') as { url?: string | null }
                          if (m.url) extra = m.url
                        } catch {
                          // ignore malformed meta
                        }
                        return (
                          <li key={ev.id} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2">
                            <Icon className={cn('size-4 shrink-0', meta.tone)} aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-xs text-[#C9D2CB]">
                              {meta.label}
                              {ev.platform ? ` · ${ev.platform}` : ''}
                              {extra ? ` · ${extra}` : ''}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-[#9AA89E]">{fmtDate(ev.createdAt)}</span>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>

                {/* Erasure */}
                <section className="rounded-xl border border-red-500/25 bg-red-500/5 p-4">
                  <h4 className="text-sm font-semibold text-red-300">Delete this customer&apos;s data</h4>
                  <p className="mt-1 text-xs leading-relaxed text-[#9AA89E]">
                    DPDP erasure: anonymises every order row (amounts stay for accounting), deletes the tracked timeline
                    permanently and writes an audit entry.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-9 border-red-500/40 text-red-300 hover:bg-red-500/10"
                    onClick={() =>
                      setErasureTarget({
                        email: profile.email,
                        name: profile.name,
                        totalOrders: profile.stats.totalOrders,
                        paidOrders: profile.stats.paidOrders,
                        lifetimeValueInr: profile.stats.lifetimeValueInr,
                        totalDownloads: profile.stats.totalDownloads,
                        firstOrderAt: profile.stats.firstOrderAt,
                        lastOrderAt: profile.stats.lastOrderAt,
                        activityEvents: profile.events.length,
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden="true" /> Erase customer data
                  </Button>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Erasure confirmation */}
      <AlertDialog open={Boolean(erasureTarget)} onOpenChange={(open) => !open && setErasureTarget(null)}>
        <AlertDialogContent className="border-white/15 bg-[#101512]">
          <AlertDialogHeader>
            <AlertDialogTitle>Erase data for “{erasureTarget?.email}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This anonymises {erasureTarget?.totalOrders ?? 0} order row(s), permanently deletes all tracked activity
              and cannot be undone. Amount totals remain for accounting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmErasure()}
              disabled={busy}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Erase permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
