'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Products table: search / zone / status filters,
// inline featured & status toggles, ↑↓ sort-order reorder,
// duplicate, delete and edit actions. Toasts everywhere.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import TablePagination, { TABLE_PAGE_SIZE } from '@/components/admin/TablePagination'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { parseProduct } from '@/store/app-store'
import {
  categoryLabel,
  formatMoney,
  type ProductRow,
  type Zone,
} from '@/types/marketplace'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface AdminProductsProps {
  onEditProduct: (product: ProductRow | null) => void
}

type Parsed = ReturnType<typeof parseProduct>
interface Row {
  raw: ProductRow
  parsed: Parsed
}

type StatusFilter = 'all' | 'published' | 'draft' | 'archived'

function ZoneBadge({ zone }: { zone: Zone }) {
  return zone === 'kids' ? (
    <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-300">KIDS</Badge>
  ) : (
    <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-300">CREATOR</Badge>
  )
}

export default function AdminProducts({ onEditProduct }: AdminProductsProps) {
  const { toast } = useToast()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [zoneFilter, setZoneFilter] = useState<'all' | Zone>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ status: statusFilter, sort: 'newest' })
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim())
    if (zoneFilter !== 'all') params.set('zone', zoneFilter)
    try {
      const res = await adminFetch(`/api/products?${params.toString()}`)
      const data = (await res.json().catch(() => null)) as { products?: ProductRow[]; error?: string } | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Failed to load products')
      setProducts(data.products ?? [])
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load products', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, statusFilter, zoneFilter, toast])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  const rows = useMemo<Row[]>(() => products.map((raw) => ({ raw, parsed: parseProduct({ ...raw }) })), [products])

  // Pagination (12 per page) — search, filters, reorder, bulk and CSV
  // all keep operating on the full `rows` list.
  const productPageCount = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE))
  const safeProductPage = Math.min(page, productPageCount)
  const pagedRows = rows.slice((safeProductPage - 1) * TABLE_PAGE_SIZE, safeProductPage * TABLE_PAGE_SIZE)

  async function patchProduct(id: string, body: Record<string, unknown>, successTitle: string) {
    setBusyId(id)
    try {
      const res = await adminFetch(`/api/products/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      toast({ title: successTitle })
      await fetchProducts()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Update failed', variant: 'destructive' })
      throw err
    } finally {
      setBusyId(null)
    }
  }

  async function toggleFeatured(row: Row) {
    await patchProduct(row.raw.id, { featured: !row.raw.featured }, row.raw.featured ? 'Removed from featured' : 'Marked as featured ⭐')
  }

  async function toggleStatus(row: Row) {
    const next = row.raw.status === 'published' ? 'draft' : 'published'
    await patchProduct(row.raw.id, { status: next }, next === 'published' ? 'Product is now live' : 'Moved to drafts')
  }

  async function move(row: Row, dir: -1 | 1) {
    const sorted = [...rows].sort((a, b) => a.raw.sortOrder - b.raw.sortOrder)
    const idx = sorted.findIndex((r) => r.raw.id === row.raw.id)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= sorted.length) return
    const a = sorted[idx].raw
    const b = sorted[swapWith].raw
    setBusyId(a.id)
    try {
      const results = await Promise.all([
        adminFetch(`/api/products/${a.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ sortOrder: b.sortOrder }) }),
        adminFetch(`/api/products/${b.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ sortOrder: a.sortOrder }) }),
      ])
      if (results.some((r) => !r.ok)) throw new Error('Reorder failed')
      toast({ title: 'Sort order updated' })
      await fetchProducts()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Reorder failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function duplicate(row: Row) {
    setBusyId(row.raw.id)
    try {
      const res = await adminFetch(`/api/products/${row.raw.id}/duplicate`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Duplicate failed')
      toast({ title: 'Duplicated as draft', description: 'Open the copy with Edit to tweak it.' })
      await fetchProducts()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Duplicate failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    setBusyId(target.id)
    try {
      // In trash view this permanently purges; elsewhere it archives (soft delete)
      const purge = statusFilter === 'archived' ? '?purge=1' : ''
      const res = await adminFetch(`/api/products/${target.id}${purge}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string; purged?: boolean } | null
      if (!res.ok) throw new Error(data?.error ?? 'Delete failed')
      toast({
        title: data?.purged ? `Permanently deleted “${target.title}”` : `Moved “${target.title}” to Trash`,
        description: data?.purged ? undefined : 'Restore it anytime from the Trash filter.',
      })
      setDeleteTarget(null)
      setSelected(new Set())
      await fetchProducts()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Delete failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function restore(row: Row) {
    await patchProduct(row.raw.id, { status: 'draft' }, `Restored “${row.raw.title}” to drafts`)
  }

  // ── CSV export of the current listing ────────────────────
  function exportCsv() {
    try {
      const header = ['title', 'slug', 'zone', 'category', 'priceInr', 'priceUsd', 'status', 'featured', 'instantDownload', 'createdAt']
      const esc = (v: unknown) => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const lines = [header.join(',')]
      for (const r of rows) {
        lines.push(
          [
            r.raw.title,
            r.raw.slug,
            r.raw.zone,
            r.raw.category,
            r.raw.priceInr,
            r.raw.priceUsd,
            r.raw.status,
            r.raw.featured,
            r.raw.instantDownload,
            r.raw.createdAt,
          ]
            .map(esc)
            .join(','),
        )
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: `Exported ${rows.length} product(s) to CSV` })
    } catch {
      toast({ title: 'CSV export failed', variant: 'destructive' })
    }
  }

  // ── Bulk actions (sequential PATCH — gentle on the database) ─────
  async function runBulk(action: 'publish' | 'unpublish' | 'archive') {
    if (selected.size === 0) return
    setBulkBusy(true)
    let ok = 0
    for (const id of selected) {
      try {
        const body = action === 'archive' ? { status: 'archived' } : { status: action === 'publish' ? 'published' : 'draft' }
        const res = await adminFetch(`/api/products/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) })
        if (res.ok) ok += 1
      } catch {
        // keep going — report the count at the end
      }
    }
    setBulkBusy(false)
    setSelected(new Set())
    toast({ title: `Bulk ${action}: ${ok}/${selected.size} updated` })
    await fetchProducts()
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-cinzel text-xl text-[#E5B842]">Products</h2>
          <p className="text-sm text-[#9AA89E]">Full control — create, edit, duplicate, archive, restore, export.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-10" onClick={exportCsv} aria-label="Export products as CSV">
            <Download className="size-4" aria-hidden="true" /> CSV
          </Button>
          <Button
            onClick={() => onEditProduct(null)}
            className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
          >
            <Plus className="size-4" aria-hidden="true" /> New Product
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9AA89E]" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="Search title or slug…"
            aria-label="Search products"
            className="h-10 pl-9"
          />
        </div>
        <Select value={zoneFilter} onValueChange={(v) => { setZoneFilter(v as 'all' | Zone); setPage(1) }}>
          <SelectTrigger className="h-10 w-full sm:w-44" aria-label="Filter by zone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All zones</SelectItem>
            <SelectItem value="kids">🎨 Kids</SelectItem>
            <SelectItem value="creator">🤖 Creator</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); setSelected(new Set()); setPage(1) }}>
          <SelectTrigger className="h-10 w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="draft">Drafts</SelectItem>
            <SelectItem value="archived">🗑 Trash</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Trash banner */}
      {statusFilter === 'archived' && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          🗑 Trash — archived products are hidden from the storefront but purchase history stays intact. Restore to drafts
          or delete forever (only possible while no orders exist).
        </p>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5B842]/30 bg-[#E5B842]/10 p-3">
          <span className="text-sm font-medium text-[#E5B842]">{selected.size} selected</span>
          <Button variant="outline" size="sm" className="h-9" disabled={bulkBusy} onClick={() => void runBulk('publish')}>
            Publish
          </Button>
          <Button variant="outline" size="sm" className="h-9" disabled={bulkBusy} onClick={() => void runBulk('unpublish')}>
            Unpublish
          </Button>
          <Button variant="outline" size="sm" className="h-9" disabled={bulkBusy} onClick={() => void runBulk('archive')}>
            <Trash2 className="size-4" aria-hidden="true" /> Archive
          </Button>
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {bulkBusy && <Loader2 className="size-4 animate-spin text-[#E5B842]" aria-hidden="true" />}
        </div>
      )}

      {/* Table */}
      <div className="glass rounded-2xl p-4 md:p-5">
        {loading ? (
          <div className="space-y-2">
            {([0, 1, 2, 3, 4, 5] as const).map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Package className="size-10 text-[#9AA89E]" aria-hidden="true" />
            <div>
              <p className="font-medium">No products found</p>
              <p className="text-sm text-[#9AA89E]">Try clearing the filters, or create something new.</p>
            </div>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => onEditProduct(null)}
            >
              <Plus className="size-4" aria-hidden="true" /> New Product
            </Button>
          </div>
        ) : (
          <>
            <Table className="min-w-[1020px]">
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead className="text-[#9AA89E]">Product</TableHead>
                <TableHead className="text-[#9AA89E]">Zone</TableHead>
                <TableHead className="text-[#9AA89E]">Category</TableHead>
                <TableHead className="text-[#9AA89E]">Price</TableHead>
                <TableHead className="text-[#9AA89E]">Featured</TableHead>
                <TableHead className="text-[#9AA89E]">Live</TableHead>
                <TableHead className="text-[#9AA89E]">Type</TableHead>
                <TableHead className="text-[#9AA89E]">Sort</TableHead>
                <TableHead className="text-right text-[#9AA89E]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((row) => {
                const p = row.raw
                const thumb = (row.parsed.images as string[])[0]
                const money = formatMoney(p.priceUsd, p.priceInr)
                return (
                  <TableRow key={p.id} className="border-white/10">
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelected(p.id)}
                        aria-label={`Select ${p.title} for bulk actions`}
                        className="size-4 cursor-pointer accent-[#E5B842]"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {thumb ? (
                          <img src={thumb} alt="" className="size-10 shrink-0 rounded-lg border border-white/10 object-cover" />
                        ) : (
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                            <Package className="size-4 text-[#9AA89E]" aria-hidden="true" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[220px] truncate text-sm font-medium">{p.title}</p>
                          <p className="max-w-[220px] truncate font-mono text-xs text-[#9AA89E]">/{p.slug}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ZoneBadge zone={p.zone} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-[#9AA89E]">
                      {categoryLabel(p.zone, p.category)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {money.inr} <span className="text-xs text-[#9AA89E]">{money.usd}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={busyId === p.id}
                        onClick={() => void toggleFeatured(row)}
                        aria-label={p.featured ? `Unfeature ${p.title}` : `Feature ${p.title}`}
                      >
                        <Star
                          className={`size-4 ${p.featured ? 'fill-[#E5B842] text-[#E5B842]' : 'text-[#9AA89E]'}`}
                          aria-hidden="true"
                        />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={p.status === 'published'}
                        disabled={busyId === p.id}
                        onCheckedChange={() => void toggleStatus(row)}
                        aria-label={`${p.status === 'published' ? 'Unpublish' : 'Publish'} ${p.title}`}
                      />
                    </TableCell>
                    <TableCell>
                      {p.instantDownload ? (
                        <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">⚡ Instant</Badge>
                      ) : (
                        <span className="text-xs text-[#9AA89E]">Link</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-center font-mono text-xs text-[#9AA89E]">{p.sortOrder}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9"
                          disabled={busyId === p.id}
                          onClick={() => void move(row, -1)}
                          aria-label={`Move ${p.title} up`}
                        >
                          <ChevronUp className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-9"
                          disabled={busyId === p.id}
                          onClick={() => void move(row, 1)}
                          aria-label={`Move ${p.title} down`}
                        >
                          <ChevronDown className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-9" aria-label={`Actions for ${p.title}`}>
                            {busyId === p.id ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <MoreHorizontal className="size-4" aria-hidden="true" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="border-white/15 bg-[#101512]">
                          {statusFilter === 'archived' ? (
                            <>
                              <DropdownMenuItem onClick={() => void restore(row)}>
                                <RotateCcw className="size-4" aria-hidden="true" /> Restore to drafts
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(p)}
                                className="text-red-400 focus:text-red-300"
                              >
                                <Trash2 className="size-4" aria-hidden="true" /> Delete forever
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => onEditProduct(p)}>
                                <Pencil className="size-4" aria-hidden="true" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void duplicate(row)}>
                                <Copy className="size-4" aria-hidden="true" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(p)}
                                className="text-red-400 focus:text-red-300"
                              >
                                <Trash2 className="size-4" aria-hidden="true" /> {p.status === 'archived' ? 'Delete forever' : 'Move to Trash'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            </Table>
            {rows.length > TABLE_PAGE_SIZE && (
              <TablePagination
                page={safeProductPage}
                pageCount={productPageCount}
                total={rows.length}
                onPageChange={setPage}
                label="products"
              />
            )}
          </>
        )}
      </div>

      {/* Delete confirmation — archive (default) or purge (from trash) */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/15 bg-[#101512]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusFilter === 'archived' ? `Delete forever “${deleteTarget?.title}”?` : `Move “${deleteTarget?.title}” to Trash?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusFilter === 'archived'
                ? 'This permanently removes the product. Products with existing orders must stay archived so purchase history remains intact.'
                : 'The product disappears from both storefronts immediately but stays recoverable from the Trash filter. Purchase history is kept.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {statusFilter === 'archived' ? 'Delete forever' : 'Move to Trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
