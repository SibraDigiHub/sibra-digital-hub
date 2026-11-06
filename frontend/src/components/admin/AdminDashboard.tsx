'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Dashboard: stat cards, revenue KPIs, conversion
// funnel, top products, operational alerts, catalogue chips,
// recent orders table and quick links (PRD v6.1 §11.1).
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Download, Plus, ReceiptText, Settings as SettingsIcon, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Order } from '@/types/marketplace'
import type { AdminTab } from '@/components/admin/AdminApp'

interface AdminStats {
  kidsCount: number
  creatorCount: number
  publishedCount: number
  draftCount: number
  archivedCount: number
  instantCount: number
  orderCount: number
  paidOrderCount: number
  pendingCount: number
  customerCount: number
  paidRevenueInr: number
  revenueToday: number
  revenue7d: number
  revenue30d: number
  // Dual payment: USD KPIs — grouped by currency, never mixed into INR.
  revenueUsdMinor: number
  revenueUsdTodayMinor: number
  revenueUsd30dMinor: number
  usdPaidOrderCount: number
  averageOrderValueInr: number
  failedEmailCount: number
  views24h: number
  alerts: string[]
  recentOrders: Order[]
}

interface MiniFunnel {
  funnel: { productViews: number; buyClicks: number; checkoutStarts: number; paidOrders: number; downloads: number }
  topProducts: { id: string; title: string; views: number; clicks: number; paidOrders: number }[]
}

interface AdminDashboardProps {
  onNavigate: (tab: AdminTab) => void
  onUnauthenticated?: () => void
}

const STATUS_STYLES: Record<Order['status'], string> = {
  paid: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  pending: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  revoked: 'border-red-500/40 bg-red-500/15 text-red-300',
  refunded: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300',
  failed: 'border-white/20 bg-white/10 text-[#9AA89E]',
}

function StatCard({ emoji, label, value, accent }: { emoji: string; label: string; value: string; accent: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-[#9AA89E]">
        <span aria-hidden="true">{emoji}</span> {label}
      </p>
      <p className="mt-1 text-3xl font-bold tracking-tight" style={{ color: accent }}>
        {value}
      </p>
    </div>
  )
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminDashboard({ onNavigate, onUnauthenticated }: AdminDashboardProps) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [mini, setMini] = useState<MiniFunnel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    adminFetch('/api/admin/stats')
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (AdminStats & { error?: string }) | null
        if (!alive) return
        if (!r.ok || !d) {
          // Session lost (expired / cookie dropped) → back to the login
          // gate instead of a dead error panel the user can't recover from.
          if (r.status === 401 && onUnauthenticated) onUnauthenticated()
          throw new Error(d?.error ?? 'Failed to load stats')
        }
        setStats(d)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load stats')
      })
    adminFetch('/api/admin/analytics?days=7')
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (MiniFunnel & { error?: string }) | null
        if (!alive || !r.ok || !d) return
        setMini({ funnel: d.funnel, topProducts: d.topProducts })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const funnelMax = mini ? Math.max(mini.funnel.productViews, 1) : 1

  return (
    <div className="space-y-5">
      <header>
        <h2 className="font-cinzel text-xl text-[#E5B842]">Dashboard</h2>
        <p className="text-sm text-[#9AA89E]">Everything happening across both storefronts, at a glance.</p>
      </header>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {/* Operational alerts */}
      {stats && stats.alerts.length > 0 && (
        <ul className="space-y-1.5">
          {stats.alerts.map((a) => (
            <li key={a} className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-amber-200/90">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {a}
            </li>
          ))}
        </ul>
      )}

      {!stats ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {([0, 1, 2, 3] as const).map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard emoji="🎨" label="Kids Products" value={String(stats.kidsCount)} accent="#FFB347" />
            <StatCard emoji="🤖" label="Creator Products" value={String(stats.creatorCount)} accent="#00F0FF" />
            <StatCard emoji="⚡" label="Instant-Delivery Items" value={String(stats.instantCount)} accent="#00F5A0" />
            <StatCard
              emoji="💰"
              label="Paid Revenue (₹)"
              value={`₹${stats.paidRevenueInr.toLocaleString('en-IN')}`}
              accent="#E5B842"
            />
          </div>

          {/* Revenue + customers row */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-7">
            <StatCard emoji="📆" label="Revenue today" value={`₹${stats.revenueToday.toLocaleString('en-IN')}`} accent="#00F5A0" />
            <StatCard emoji="🗓️" label="Revenue 7d" value={`₹${stats.revenue7d.toLocaleString('en-IN')}`} accent="#7CDDA8" />
            <StatCard emoji="📊" label="Revenue 30d" value={`₹${stats.revenue30d.toLocaleString('en-IN')}`} accent="#4ECFA0" />
            <StatCard emoji="🌐" label="USD revenue" value={`$${(stats.revenueUsdMinor / 100).toFixed(2)}`} accent="#00F0FF" />
            <StatCard emoji="🧾" label="Avg order" value={`₹${stats.averageOrderValueInr.toLocaleString('en-IN')}`} accent="#E5B842" />
            <StatCard emoji="👥" label="Customers" value={String(stats.customerCount)} accent="#00F0FF" />
            <StatCard emoji="👀" label="Views 24h" value={String(stats.views24h)} accent="#9AA89E" />
          </div>

          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
              {stats.publishedCount} Published
            </Badge>
            <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-300">
              {stats.draftCount} Drafts
            </Badge>
            {stats.archivedCount > 0 && (
              <Badge className="border-white/20 bg-white/10 text-[#C9D2CB]">
                {stats.archivedCount} in Trash
              </Badge>
            )}
            <Badge className="border-white/20 bg-white/10 text-[#C9D2CB]">
              {stats.orderCount} Total {stats.orderCount === 1 ? 'Order' : 'Orders'}
            </Badge>
            {stats.pendingCount > 0 && (
              <Badge className="border-cyan-500/40 bg-cyan-500/10 text-cyan-300">{stats.pendingCount} Pending</Badge>
            )}
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => onNavigate('products')}
              className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              <Plus className="size-4" aria-hidden="true" /> Add Product
            </Button>
            <Button variant="outline" className="h-10" onClick={() => onNavigate('orders')}>
              <ReceiptText className="size-4" aria-hidden="true" /> View Orders
            </Button>
            <Button variant="outline" className="h-10" onClick={() => onNavigate('customers')}>
              <Users className="size-4" aria-hidden="true" /> Customers
            </Button>
            <Button variant="outline" className="h-10" onClick={() => onNavigate('activity')}>
              <Activity className="size-4" aria-hidden="true" /> Activity
            </Button>
            <Button variant="outline" className="h-10" onClick={() => onNavigate('system')}>
              <Download className="size-4" aria-hidden="true" /> Backups
            </Button>
            <Button variant="outline" className="h-10" onClick={() => onNavigate('settings')}>
              <SettingsIcon className="size-4" aria-hidden="true" /> Site Settings
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Mini funnel */}
            <section className="glass rounded-2xl p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Funnel · 7 days</h3>
                <Button variant="ghost" size="sm" className="h-8 text-xs text-[#9AA89E]" onClick={() => onNavigate('activity')}>
                  Full analytics →
                </Button>
              </div>
              {!mini ? (
                <Skeleton className="h-40 rounded-xl" />
              ) : (
                <ul className="space-y-2 text-sm">
                  {[
                    { label: '👀 Product views', value: mini.funnel.productViews, max: funnelMax, tone: 'bg-sky-400' },
                    { label: '🖱️ Buy / store clicks', value: mini.funnel.buyClicks, max: funnelMax, tone: 'bg-amber-400' },
                    { label: '🧾 Checkouts', value: mini.funnel.checkoutStarts, max: funnelMax, tone: 'bg-cyan-400' },
                    { label: '💸 Paid', value: mini.funnel.paidOrders, max: funnelMax, tone: 'bg-emerald-400' },
                    { label: '📥 Downloads', value: mini.funnel.downloads, max: funnelMax, tone: 'bg-violet-400' },
                  ].map((row) => (
                    <li key={row.label}>
                      <div className="flex justify-between text-xs text-[#C9D2CB]">
                        <span>{row.label}</span>
                        <span className="font-mono font-semibold text-[#F5F8F6]">{row.value}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                        <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${Math.max((row.value / row.max) * 100, row.value > 0 ? 6 : 1.5)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Top products */}
            <section className="glass rounded-2xl p-4 md:p-5">
              <h3 className="mb-3 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Top products · 7 days</h3>
              {!mini ? (
                <Skeleton className="h-40 rounded-xl" />
              ) : mini.topProducts.length === 0 ? (
                <p className="text-sm text-[#9AA89E]">No product activity yet — open the storefront and browse around.</p>
              ) : (
                <ol className="space-y-2">
                  {mini.topProducts.slice(0, 5).map((p, i) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                      <span className="w-5 text-center font-mono text-xs text-[#9AA89E]">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                      <span className="shrink-0 font-mono text-xs text-[#9AA89E]">
                        {p.views} views · {p.paidOrders} paid
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {/* Recent orders */}
          <section className="glass rounded-2xl p-4 md:p-5">
            <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Recent Orders</h3>
            {stats.recentOrders.length === 0 ? (
              <p className="mt-4 text-sm text-[#9AA89E]">
                No orders yet — ⚡ instant-download purchases will appear here in real time.
              </p>
            ) : (
              <div className="mt-3">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-[#9AA89E]">Date</TableHead>
                      <TableHead className="text-[#9AA89E]">Customer</TableHead>
                      <TableHead className="text-[#9AA89E]">Product</TableHead>
                      <TableHead className="text-[#9AA89E]">Amount</TableHead>
                      <TableHead className="text-[#9AA89E]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentOrders.map((o) => (
                      <TableRow key={o.id} className="border-white/10">
                        <TableCell className="whitespace-nowrap text-xs text-[#9AA89E]">{fmtDate(o.createdAt)}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{o.customerName}</p>
                          <p className="text-xs text-[#9AA89E]">{o.customerEmail}</p>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm">{o.product?.title ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm font-semibold text-[#E5B842]">
                          ₹{o.amountInr.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_STYLES[o.status] ?? STATUS_STYLES.failed}>
                            {o.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
