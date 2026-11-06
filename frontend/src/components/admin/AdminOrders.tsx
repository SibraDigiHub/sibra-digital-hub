'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Orders: instant-delivery purchase log with email
// resend, download-token extend/revoke and status badges.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import OrderWatchPanel from '@/components/admin/OrderWatchPanel'
import TablePagination, { TABLE_PAGE_SIZE } from '@/components/admin/TablePagination'
import { useCallback, useEffect, useState } from 'react'
import { Ban, Clock, Download, FileText, Info, Loader2, MailCheck, MailX, RefreshCcw, Search, Send, IndianRupee, X } from 'lucide-react'

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

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const STATUS_STYLES: Record<Order['status'], string> = {
  paid: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  pending: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  revoked: 'border-red-500/40 bg-red-500/15 text-red-300',
  refunded: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300',
  failed: 'border-white/20 bg-white/10 text-[#9AA89E]',
}

interface TimelineEvent {
  id: string
  type: string
  platform: string | null
  createdAt: string
}

interface OrderDetail {
  order: Order
  events: TimelineEvent[]
}

const EVENT_LABELS: Record<string, string> = {
  product_view: '👀 Viewed product',
  buy_click: '🛒 Buy click',
  platform_click: '🔗 Store click',
  checkout_started: '🧾 Checkout started',
  order_paid: '💸 Paid',
  download: '📥 File downloaded',
  email_sent: '📧 Delivery email sent',
  email_resent: '📧 Email re-sent',
  search: '🔍 Search',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminOrders() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<Order | null>(null)
  const [refundTarget, setRefundTarget] = useState<Order | null>(null)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim())
    try {
      const res = await adminFetch(`/api/orders?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { orders?: Order[]; error?: string } | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Failed to load orders')
      setOrders(data.orders ?? [])
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load orders', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, toast])

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  async function resend(o: Order) {
    setBusyId(o.id)
    try {
      const res = await adminFetch(`/api/orders/${o.id}/resend`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { emailDemo?: boolean; error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Resend failed')
      toast({
        title: data?.emailDemo ? 'Demo mode: email not configured' : 'Delivery email re-sent',
        description: data?.emailDemo ? undefined : `To ${o.customerEmail}`,
      })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Resend failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  /** Invoice — PDF in the currency the order was actually billed in. */
  async function downloadInvoice(o: Order) {
    setBusyId(o.id)
    try {
      const res = await adminFetch(`/api/orders/${o.id}/invoice`)
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error ?? 'Invoice download failed')
      }
      const disposition = res.headers.get('content-disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = match?.[1] ?? `invoice-${o.id}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Invoice downloaded', description: match?.[1] ?? undefined })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Invoice download failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  /** §9 "Reconcile now": ask the gateway for the latest payment status. */
  async function reconcile(o: Order) {
    setBusyId(o.id)
    try {
      // POST /api/admin/orders/[id]/reconcile — the handler lives under the
      // admin namespace (the old /api/orders/… path never existed and the
      // button always got a 404).
      const res = await adminFetch(`/api/admin/orders/${o.id}/reconcile`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { action?: string; detail?: string; error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Reconcile failed')
      const friendly: Record<string, string> = {
        fulfilled: 'Payment confirmed — the order is fulfilled.',
        still_pending: 'Gateway says the payment is still pending.',
        expired: 'No payment after 24h — the order was marked failed.',
        skipped: `Nothing to do (${data?.detail ?? 'skipped'}).`,
        error: 'Gateway check failed — try again shortly.',
      }
      toast({
        title: friendly[data?.action ?? 'error'] ?? 'Reconcile finished',
        description: data?.action === 'fulfilled' ? 'Delivery email is on its way.' : undefined,
      })
      void fetchOrders()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Reconcile failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function patchToken(o: Order, action: 'revoke' | 'extend', successTitle: string) {
    setBusyId(o.id)
    try {
      const res = await adminFetch(`/api/orders/${o.id}/token`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ action }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      toast({ title: successTitle })
      await fetchOrders()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Update failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    await patchToken(revokeTarget, 'revoke', 'Download access revoked')
    setRevokeTarget(null)
  }

  async function confirmRefund() {
    if (!refundTarget) return
    const target = refundTarget
    setBusyId(target.id)
    try {
      const res = await adminFetch(`/api/orders/${target.id}/refund`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Refund failed')
      toast({ title: 'Order marked refunded', description: 'Download access has been revoked.' })
      setRefundTarget(null)
      await fetchOrders()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Refund failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function openDetail(o: Order) {
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await adminFetch(`/api/admin/orders/${o.id}`)
      const data = (await res.json().catch(() => null)) as (OrderDetail & { error?: string }) | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Failed to load order detail')
      setDetail(data)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load order detail', variant: 'destructive' })
    } finally {
      setDetailLoading(false)
    }
  }

  function exportCsv() {
    try {
      const header = ['date', 'customer', 'email', 'product', 'amountInr', 'status', 'downloads', 'emailSent']
      const esc = (v: unknown) => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const lines = [header.join(',')]
      for (const o of orders) {
        lines.push(
          [o.createdAt, o.customerName, o.customerEmail, o.product?.title ?? '', o.amountInr, o.status, o.downloadCount, o.emailSent]
            .map(esc)
            .join(','),
        )
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: `Exported ${orders.length} order(s) to CSV` })
    } catch {
      toast({ title: 'CSV export failed', variant: 'destructive' })
    }
  }

  // Pagination (12 per page) — the CSV export above still covers the full list.
  const orderPageCount = Math.max(1, Math.ceil(orders.length / TABLE_PAGE_SIZE))
  const safeOrderPage = Math.min(page, orderPageCount)
  const pagedOrders = orders.slice((safeOrderPage - 1) * TABLE_PAGE_SIZE, safeOrderPage * TABLE_PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-cinzel text-xl text-[#E5B842]">Orders</h2>
          <p className="text-sm text-[#9AA89E]">Instant-delivery purchases, delivery controls and refunds.</p>
        </div>
        <Button variant="outline" className="h-10" onClick={exportCsv} aria-label="Export orders as CSV">
          <Download className="size-4" aria-hidden="true" /> CSV
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Only ⚡ instant-download products create orders. Marketplace sales (Amazon/Gumroad etc.) are tracked on those
        platforms.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9AA89E]" aria-hidden="true" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="Search by customer name or email…"
          aria-label="Search orders"
          className="h-10 pl-9"
        />
      </div>

      <div className="glass rounded-2xl p-4 md:p-5">
        {loading ? (
          <div className="space-y-2">
            {([0, 1, 2, 3, 4] as const).map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Send className="size-10 text-[#9AA89E]" aria-hidden="true" />
            <p className="font-medium">No orders found</p>
            <p className="text-sm text-[#9AA89E]">
              {debouncedQ ? 'No matches for that search.' : '⚡ instant-download sales will land here automatically.'}
            </p>
          </div>
        ) : (
          <>
            <Table className="min-w-[1160px]">
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-[#9AA89E]">Date</TableHead>
                  <TableHead className="text-[#9AA89E]">Customer</TableHead>
                  <TableHead className="text-[#9AA89E]">Product</TableHead>
                  <TableHead className="text-[#9AA89E]">Gateway</TableHead>
                  <TableHead className="text-[#9AA89E]">Amount</TableHead>
                  <TableHead className="text-[#9AA89E]">Status</TableHead>
                  <TableHead className="text-[#9AA89E]">Downloads</TableHead>
                  <TableHead className="text-[#9AA89E]">Token expires</TableHead>
                  <TableHead className="text-[#9AA89E]">Email</TableHead>
                  <TableHead className="text-right text-[#9AA89E]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedOrders.map((o) => (
                  <TableRow key={o.id} className="border-white/10">
                    <TableCell className="whitespace-nowrap text-xs text-[#9AA89E]">{fmtDate(o.createdAt)}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{o.customerName}</p>
                      <p className="max-w-[200px] truncate text-xs text-[#9AA89E]">{o.customerEmail}</p>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <p className="truncate text-sm">{o.product?.title ?? '—'}</p>
                      {o.product?.deliverableName && (
                        <p className="truncate font-mono text-[11px] text-[#9AA89E]">{o.product.deliverableName}</p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="border-white/15 text-[10px] uppercase tracking-wide text-[#9AA89E]">
                        {o.gateway === 'paypal' ? 'PayPal (legacy)' : 'Razorpay'}
                      </Badge>
                      {o.billingCountry && <p className="mt-1 text-[11px] text-[#9AA89E]">{o.billingCountry}</p>}
                      {o.riskFlags && o.riskFlags.length > 0 && (
                        <p className="mt-0.5 text-[10px] font-semibold text-amber-400" title={o.riskFlags.join(', ')}>
                          ⚠ {o.riskFlags.length}
                        </p>
                      )}
                      {/* P5: captured money the shop could not deliver — must be unmistakable */}
                      {o.riskFlags?.includes('PAID_BUT_NOT_DELIVERED') && (
                        <Badge variant="outline" className="mt-1 border-red-500/50 bg-red-500/15 text-[10px] font-bold tracking-wide text-red-300">
                          PAID_BUT_NOT_DELIVERED
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-semibold text-[#E5B842]">
                      {o.currency === 'USD'
                        ? `$${((o.amountMinor ?? 0) / 100).toFixed(2)}`
                        : `₹${o.amountInr.toLocaleString('en-IN')}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[o.status] ?? STATUS_STYLES.failed}>
                        {o.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{o.downloadCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-[#9AA89E]">
                      {o.tokenExpiresAt ? fmtDate(o.tokenExpiresAt) : '—'}
                    </TableCell>
                    <TableCell>
                      {o.emailSent ? (
                        <MailCheck className="size-4 text-emerald-400" aria-label="Delivery email sent" />
                      ) : (
                        <MailX className="size-4 text-[#9AA89E]" aria-label="Delivery email not sent" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          onClick={() => void openDetail(o)}
                          aria-label={`View timeline for the order of ${o.customerName}`}
                          title="View journey timeline"
                        >
                          <Info className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9"
                          disabled={busyId === o.id || o.status !== 'paid'}
                          onClick={() => void downloadInvoice(o)}
                          aria-label={`Download the invoice PDF for the order of ${o.customerName}`}
                          title="Download invoice (PDF, paid orders)"
                        >
                          {busyId === o.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <FileText className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9"
                          disabled={busyId === o.id}
                          onClick={() => void resend(o)}
                          aria-label={`Resend delivery email to ${o.customerEmail}`}
                          title="Resend delivery email"
                        >
                          {busyId === o.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Send className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9"
                          disabled={busyId === o.id || o.status !== 'pending'}
                          onClick={() => void reconcile(o)}
                          aria-label={`Reconcile the ${o.gateway === 'paypal' ? 'PayPal' : 'Razorpay'} payment for ${o.customerName}`}
                          title="Reconcile now — ask the gateway for the latest status"
                        >
                          <RefreshCcw className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9"
                          disabled={busyId === o.id || o.status === 'revoked'}
                          onClick={() => void patchToken(o, 'extend', '+72h added to download link')}
                          aria-label={`Extend download token for ${o.customerName}`}
                          title="Extend token +72h"
                        >
                          <Clock className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9 hover:border-red-500/50 hover:text-red-300"
                          disabled={busyId === o.id || o.status === 'revoked'}
                          onClick={() => setRevokeTarget(o)}
                          aria-label={`Revoke download access for ${o.customerName}`}
                          title="Revoke access"
                        >
                          <Ban className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9 hover:border-fuchsia-500/50 hover:text-fuchsia-300"
                          disabled={busyId === o.id || (o.status !== 'paid' && o.status !== 'revoked')}
                          onClick={() => setRefundTarget(o)}
                          aria-label={`Refund the order of ${o.customerName}`}
                          title="Mark refunded (revokes access)"
                        >
                          <IndianRupee className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {orders.length > TABLE_PAGE_SIZE && (
              <TablePagination
                page={safeOrderPage}
                pageCount={orderPageCount}
                total={orders.length}
                onPageChange={setPage}
                label="orders"
              />
            )}
          </>
        )}
      </div>

      {/* Revoke confirmation */}
      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent className="border-white/15 bg-[#101512]">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke download access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.customerName} ({revokeTarget?.customerEmail}) will immediately lose access to the
              delivered file. This cannot be undone — you can still resend the email later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRevoke()} className="bg-red-600 text-white hover:bg-red-500">
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund confirmation */}
      <AlertDialog open={Boolean(refundTarget)} onOpenChange={(open) => !open && setRefundTarget(null)}>
        <AlertDialogContent className="border-white/15 bg-[#101512]">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark order refunded?</AlertDialogTitle>
            <AlertDialogDescription>
              {refundTarget?.currency === 'USD' && refundTarget?.amountMinor
                ? `$${(refundTarget.amountMinor / 100).toFixed(2)}`
                : `₹${refundTarget?.amountInr.toLocaleString('en-IN')}`}{' '}
              — {refundTarget?.customerEmail}. The order is marked refunded and download access is revoked immediately
              {refundTarget?.customerName ? ` (${refundTarget.customerName})` : ''}. Process the actual money in your{' '}
              {refundTarget?.gateway === 'paypal' ? 'PayPal' : 'Razorpay'} dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRefund()} className="bg-fuchsia-600 text-white hover:bg-fuchsia-500">
              Mark Refunded
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Order detail drawer with activity timeline */}
      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Order detail and timeline"
          onClick={() => !detailLoading && setDetail(null)}
        >
          <div
            className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#0B0F0C] p-5 nice-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !detail ? (
              <div className="space-y-3">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-64 rounded-2xl" />
              </div>
            ) : (
              <div className="space-y-5">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-cinzel text-lg text-[#E5B842]">{detail.order.product?.title ?? 'Order'}</h3>
                    <p className="truncate text-sm text-[#9AA89E]">
                      {detail.order.customerName} · {detail.order.customerEmail}
                    </p>
                    {/* The delivery email quotes this id — support needs to match it back. */}
                    <p className="truncate font-mono text-[11px] text-[#6B7A6E]">Order ID: {detail.order.id}</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setDetail(null)}>
                    <X className="size-4" aria-hidden="true" /> Close
                  </Button>
                </header>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Amount', value: `₹${detail.order.amountInr.toLocaleString('en-IN')}` },
                    { label: 'Status', value: detail.order.status },
                    { label: 'Downloads', value: String(detail.order.downloadCount) },
                    { label: 'Placed', value: fmtDate(detail.order.createdAt) },
                  ].map((s) => (
                    <div key={s.label} className="glass rounded-xl p-3 text-center">
                      <p className="truncate text-sm font-bold text-[#F5F8F6]">{s.value}</p>
                      <p className="text-[11px] text-[#9AA89E]">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* T-V Feature C — protected watch link controls (watch-mode orders) */}
                {detail.order.product?.deliveryMode === 'watch' && <OrderWatchPanel orderId={detail.order.id} />}

                <section>
                  <h4 className="mb-2 font-cinzel text-xs uppercase tracking-widest text-[#E5B842]">Journey timeline</h4>
                  {detail.events.length === 0 ? (
                    <p className="text-sm text-[#9AA89E]">No tracked events for this order.</p>
                  ) : (
                    <ol className="space-y-1.5">
                      {detail.events.map((ev) => (
                        <li key={ev.id} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-[#C9D2CB]">
                            {EVENT_LABELS[ev.type] ?? ev.type}
                            {ev.platform ? ` · ${ev.platform}` : ''}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-[#9AA89E]">{fmtDate(ev.createdAt)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
