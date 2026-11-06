'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Activity & Analytics (PRD v6.1 §11.1/§11.7):
// conversion funnel, revenue KPIs + sparkline, top products,
// platform click share, device/country split and a live feed.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, MousePointerClick, Pause, Play, ShoppingCart, Download, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface Analytics {
  windowDays: number
  funnel: {
    productViews: number
    buyClicks: number
    checkoutStarts: number
    paidOrders: number
    downloads: number
    conversionPct: number
  }
  revenue: { today: number; last7d: number; last30d: number; total: number; series: { date: string; revenue: number; orders: number }[] }
  uniqueVisitors: number
  topProducts: { id: string; title: string; slug: string; zone: string; views: number; clicks: number; paidOrders: number }[]
  platformShare: { platform: string; clicks: number }[]
  deviceSplit: { device: string; count: number }[]
  countries: { country: string; count: number }[]
  recentEvents: { id: string; type: string; platform: string | null; productId: string | null; email: string | null; device: string | null; createdAt: string }[]
}

const EVENT_LABELS: Record<string, string> = {
  product_view: '👀 Viewed product',
  buy_click: '🛒 Buy click',
  platform_click: '🔗 Store click',
  checkout_started: '🧾 Checkout started',
  order_paid: '💸 Paid',
  download: '📥 Downloaded',
  email_sent: '📧 Email sent',
  email_resent: '📧 Email re-sent',
  search: '🔍 Search',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Tiny inline SVG sparkline for the revenue series. */
function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1)
  const w = 560
  const h = 60
  const step = points.length > 1 ? w / (points.length - 1) : w
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p / max) * (h - 6) - 3).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke="#E5B842" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function FunnelRow({ icon: Icon, label, value, max, tone }: { icon: typeof Eye; label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 6 : 1.5) : 1.5
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-[#C9D2CB]">
          <Icon className="size-3.5" aria-hidden="true" /> {label}
        </span>
        <span className="font-mono font-semibold text-[#F5F8F6]">{value.toLocaleString('en-IN')}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/5">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function AdminActivity() {
  const { toast } = useToast()
  const [days, setDays] = useState<'7' | '30' | '90'>('7')
  const [data, setData] = useState<Analytics | null>(null)
  const [live, setLive] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAnalytics = useCallback(
    async (silent = false) => {
      if (!silent) setData(null)
      try {
        const res = await adminFetch(`/api/admin/analytics?days=${days}`)
        const d = (await res.json().catch(() => null)) as (Analytics & { error?: string }) | null
        if (!res.ok || !d) throw new Error(d?.error ?? 'Failed to load analytics')
        setData(d)
      } catch (err) {
        if (!silent) toast({ title: err instanceof Error ? err.message : 'Failed to load analytics', variant: 'destructive' })
      }
    },
    [days, toast],
  )

  useEffect(() => {
    void fetchAnalytics()
  }, [fetchAnalytics])

  // Live feed auto-refresh (15 s), pausable
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (live) {
      timer.current = setInterval(() => void fetchAnalytics(true), 15000)
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [live, fetchAnalytics])

  const funnel = data?.funnel
  const maxFunnel = funnel ? Math.max(funnel.productViews, 1) : 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-cinzel text-xl text-[#E5B842]">Activity &amp; Analytics</h2>
          <p className="text-sm text-[#9AA89E]">The full funnel — views → clicks → checkout → paid → download.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={(v) => setDays(v as '7' | '30' | '90')}>
            <SelectTrigger className="h-10 w-36" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-10" onClick={() => setLive((v) => !v)} aria-pressed={live}>
            {live ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            {live ? 'Live' : 'Paused'}
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            {([0, 1, 2, 3, 4] as const).map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Funnel KPI cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Kpi emoji="👀" label="Product views" value={data.funnel.productViews} />
            <Kpi emoji="🖱️" label="Buy clicks" value={data.funnel.buyClicks} />
            <Kpi emoji="🧾" label="Checkouts" value={data.funnel.checkoutStarts} />
            <Kpi emoji="💸" label="Paid orders" value={data.funnel.paidOrders} />
            <Kpi emoji="📥" label="Downloads" value={data.funnel.downloads} />
            <Kpi emoji="🎯" label="Conversion" value={data.funnel.conversionPct} suffix="%" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Funnel bars */}
            <section className="glass rounded-2xl p-4 md:p-5">
              <h3 className="mb-4 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Conversion funnel · last {data.windowDays}d</h3>
              <div className="space-y-3.5">
                <FunnelRow icon={Eye} label="Product views" value={data.funnel.productViews} max={maxFunnel} tone="bg-sky-400" />
                <FunnelRow icon={MousePointerClick} label="Buy / store clicks" value={data.funnel.buyClicks} max={maxFunnel} tone="bg-amber-400" />
                <FunnelRow icon={ShoppingCart} label="Checkout started" value={data.funnel.checkoutStarts} max={maxFunnel} tone="bg-cyan-400" />
                <FunnelRow icon={Wallet} label="Paid" value={data.funnel.paidOrders} max={maxFunnel} tone="bg-emerald-400" />
                <FunnelRow icon={Download} label="Downloaded" value={data.funnel.downloads} max={maxFunnel} tone="bg-violet-400" />
              </div>
            </section>

            {/* Revenue */}
            <section className="glass rounded-2xl p-4 md:p-5">
              <h3 className="mb-4 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Revenue</h3>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: 'Today', value: data.revenue.today },
                  { label: '7 days', value: data.revenue.last7d },
                  { label: '30 days', value: data.revenue.last30d },
                  { label: 'All time', value: data.revenue.total },
                ].map((r) => (
                  <div key={r.label} className="rounded-xl bg-white/[0.04] p-2.5">
                    <p className="text-sm font-bold text-[#E5B842]">₹{r.value.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-[#9AA89E]">{r.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Sparkline points={data.revenue.series.map((s) => s.revenue)} />
                <p className="mt-1 text-center text-[10px] text-[#9AA89E]">
                  Daily paid revenue · last {data.windowDays} days · {data.uniqueVisitors} unique visitor(s)
                </p>
              </div>
            </section>

            {/* Top products */}
            <section className="glass rounded-2xl p-4 md:p-5">
              <h3 className="mb-3 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Top products</h3>
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-[#9AA89E]">No product activity in this window yet.</p>
              ) : (
                <Table className="min-w-[420px]">
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-[#9AA89E]">Product</TableHead>
                      <TableHead className="text-right text-[#9AA89E]">Views</TableHead>
                      <TableHead className="text-right text-[#9AA89E]">Clicks</TableHead>
                      <TableHead className="text-right text-[#9AA89E]">Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topProducts.map((p) => (
                      <TableRow key={p.id} className="border-white/10">
                        <TableCell className="max-w-[240px]">
                          <p className="truncate text-sm">{p.title}</p>
                          <p className="text-[10px] uppercase tracking-wide text-[#9AA89E]">{p.zone === 'kids' ? '🎨 Kids' : '🤖 Creator'}</p>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{p.views}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{p.clicks}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-emerald-300">{p.paidOrders}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            {/* Platform share + devices + countries */}
            <section className="glass space-y-5 rounded-2xl p-4 md:p-5">
              <div>
                <h3 className="mb-3 font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Store click share</h3>
                {data.platformShare.length === 0 ? (
                  <p className="text-sm text-[#9AA89E]">No store-button clicks in this window yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.platformShare.slice(0, 6).map((p) => {
                      const max = data.platformShare[0]?.clicks || 1
                      return (
                        <div key={p.platform}>
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="capitalize text-[#C9D2CB]">{p.platform.replace(/-/g, ' ')}</span>
                            <span className="font-mono text-[#F5F8F6]">{p.clicks}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/5">
                            <div className="h-full rounded-full bg-gradient-to-r from-[#E5B842] to-amber-300" style={{ width: `${(p.clicks / max) * 100}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9AA89E]">Devices</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.deviceSplit.length === 0 ? (
                      <span className="text-xs text-[#9AA89E]">—</span>
                    ) : (
                      data.deviceSplit.map((d) => (
                        <span key={d.device} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs capitalize text-[#C9D2CB]">
                          {d.device} · {d.count}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9AA89E]">Countries</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.countries.length === 0 ? (
                      <span className="text-xs text-[#9AA89E]">—</span>
                    ) : (
                      data.countries.map((c) => (
                        <span key={c.country} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-[#C9D2CB]">
                          {c.country} · {c.count}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Live feed */}
          <section className="glass rounded-2xl p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Live activity feed</h3>
              <span className="flex items-center gap-1.5 text-xs text-[#9AA89E]">
                <span className={cn('size-2 rounded-full', live ? 'animate-pulse bg-emerald-400' : 'bg-[#9AA89E]')} aria-hidden="true" />
                {live ? 'auto-refresh 15s' : 'paused'}
              </span>
            </div>
            {data.recentEvents.length === 0 ? (
              <p className="text-sm text-[#9AA89E]">No tracked events yet — browse the storefront and they appear here instantly.</p>
            ) : (
              <ol className="max-h-96 space-y-1.5 overflow-y-auto pr-1 nice-scroll" aria-label="Recent activity events">
                {data.recentEvents.map((ev) => (
                  <li key={ev.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="font-medium text-[#F5F8F6]">{EVENT_LABELS[ev.type] ?? ev.type}</span>
                    {ev.platform && <span className="rounded bg-white/10 px-1.5 py-0.5 capitalize text-[#C9D2CB]">{ev.platform.replace(/-/g, ' ')}</span>}
                    {ev.device && <span className="text-[#9AA89E]">on {ev.device}</span>}
                    {ev.email && <span className="max-w-[180px] truncate text-[#9AA89E]">· {ev.email}</span>}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-[#9AA89E]">{fmtDate(ev.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ emoji, label, value, suffix = '' }: { emoji: string; label: string; value: number; suffix?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-[#9AA89E]">
        <span aria-hidden="true">{emoji}</span> {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-[#F5F8F6]">
        {value.toLocaleString('en-IN')}
        {suffix}
      </p>
    </div>
  )
}
