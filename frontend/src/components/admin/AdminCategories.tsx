'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Categories (T10): fully dynamic, admin-managed product
// categories. Create / rename / re-emoji / reorder / hide / delete
// — every change is live on the storefront immediately (chips,
// product form, journey slider, labels) with zero code changes.
// Delete is blocked while products still use the category.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { refreshCategories } from '@/lib/categories'
import { slugify } from '@/lib/platforms'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Tags,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import type { Zone } from '@/types/marketplace'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface AdminCategory {
  id: string
  zone: Zone
  slug: string
  label: string
  emoji: string
  blurb: string
  sortOrder: number
  active: boolean
  productCount: number
  createdAt: string
  updatedAt: string
}

type ZoneFilter = 'all' | Zone

const EMOJI_PRESETS = ['🎨', '🧩', '📚', '🔤', '🃏', '👩‍👧', '🖌️', '🤖', '🎬', '⚡', '🧑‍💻', '📄', '🎁', '🛠️', '🧠', '✨']

function ZoneBadge({ zone }: { zone: Zone }) {
  return zone === 'kids' ? (
    <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-300">KIDS</Badge>
  ) : (
    <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-300">CREATOR</Badge>
  )
}

interface FormState {
  zone: Zone
  label: string
  slug: string
  slugTouched: boolean
  emoji: string
  blurb: string
}

const emptyForm: FormState = { zone: 'kids', label: '', slug: '', slugTouched: false, emoji: '', blurb: '' }

export default function AdminCategories() {
  const { toast } = useToast()
  const [cats, setCats] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  // create / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCategory | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null)

  const fetchCats = useCallback(async () => {
    // Refetch after admin mutations — called from event handlers only,
    // so it updates the table in place (no spinner flash).
    try {
      const res = await adminFetch('/api/admin/categories')
      const data = (await res.json().catch(() => null)) as { categories?: AdminCategory[]; error?: string } | null
      if (!res.ok || !data) throw new Error(data?.error ?? 'Failed to load categories')
      setCats(data.categories ?? [])
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to load categories', variant: 'destructive' })
    }
  }, [toast])

  // Initial load — promise chain (same pattern as AdminDashboard) so the
  // effect body stays free of synchronous setState.
  useEffect(() => {
    let alive = true
    adminFetch('/api/admin/categories')
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as { categories?: AdminCategory[]; error?: string } | null
        if (!alive) return
        if (!r.ok || !d) throw new Error(d?.error ?? 'Failed to load categories')
        setCats(d.categories ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        toast({ title: err instanceof Error ? err.message : 'Failed to load categories', variant: 'destructive' })
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    const visible = zoneFilter === 'all' ? cats : cats.filter((c) => c.zone === zoneFilter)
    return [...visible].sort((a, b) => a.zone.localeCompare(b.zone) || a.sortOrder - b.sortOrder)
  }, [cats, zoneFilter])

  // ── Create / edit ─────────────────────────────────────────
  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(cat: AdminCategory) {
    setEditing(cat)
    setForm({ zone: cat.zone, label: cat.label, slug: cat.slug, slugTouched: true, emoji: cat.emoji, blurb: cat.blurb })
    setDialogOpen(true)
  }

  function setLabel(label: string) {
    setForm((f) => ({ ...f, label, slug: f.slugTouched ? f.slug : slugify(label) }))
  }

  async function save() {
    const label = form.label.trim()
    if (label.length < 2) {
      toast({ title: 'Category name must be at least 2 characters', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const res = await adminFetch(`/api/admin/categories/${editing.id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ label, emoji: form.emoji.trim(), blurb: form.blurb.trim() }),
        })
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'Update failed')
        toast({ title: `Renamed to “${label}”`, description: 'Storefront updated instantly.' })
      } else {
        const body: Record<string, unknown> = { zone: form.zone, label, emoji: form.emoji.trim() || '📦', blurb: form.blurb.trim() }
        const slug = form.slug.trim()
        if (slug) body.slug = slug
        const res = await adminFetch('/api/admin/categories', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        })
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error ?? 'Create failed')
        toast({ title: `Category “${label}” created 🎉`, description: 'It is live on the storefront right now.' })
      }
      setDialogOpen(false)
      await fetchCats()
      await refreshCategories()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ── Inline mutations ──────────────────────────────────────
  async function toggleActive(cat: AdminCategory) {
    setBusyId(cat.id)
    try {
      const res = await adminFetch(`/api/admin/categories/${cat.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ active: !cat.active }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      toast({
        title: cat.active ? `“${cat.label}” hidden from storefront` : `“${cat.label}” is visible again`,
        description: cat.active ? 'Products keep their category — nothing else changes.' : undefined,
      })
      await fetchCats()
      await refreshCategories()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Update failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function move(cat: AdminCategory, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === cat.id)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return
    if (rows[swapWith].zone !== cat.zone) return // order is per-zone — never cross zones
    const a = rows[idx]
    const b = rows[swapWith]
    setBusyId(cat.id)
    try {
      const results = await Promise.all([
        adminFetch(`/api/admin/categories/${a.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ sortOrder: b.sortOrder }) }),
        adminFetch(`/api/admin/categories/${b.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ sortOrder: a.sortOrder }) }),
      ])
      if (results.some((r) => !r.ok)) throw new Error('Reorder failed')
      toast({ title: 'Order updated' })
      await fetchCats()
      await refreshCategories()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Reorder failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    setBusyId(target.id)
    try {
      const res = await adminFetch(`/api/admin/categories/${target.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Delete failed')
      toast({ title: `Deleted “${target.label}”`, description: 'The storefront no longer shows this category.' })
      setDeleteTarget(null)
      await fetchCats()
      await refreshCategories()
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Delete failed',
        description: 'Tip: hide the category instead — products keep working.',
        variant: 'destructive',
      })
      setDeleteTarget(null)
    } finally {
      setBusyId(null)
    }
  }

  const slugPreview = form.slug.trim() || slugify(form.label)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-cinzel text-xl text-[#E5B842]">Categories</h2>
          <p className="max-w-xl text-sm text-[#9AA89E]">
            Dynamic product categories — anything you create here appears on the storefront (chips, product form,
            journey slider, search) automatically. No code changes needed.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={zoneFilter} onValueChange={(v) => setZoneFilter(v as ZoneFilter)}>
            <SelectTrigger className="h-10 w-full sm:w-40" aria-label="Filter by zone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              <SelectItem value="kids">🎨 Kids</SelectItem>
              <SelectItem value="creator">🤖 Creator</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={openCreate}
            className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
          >
            <Plus className="size-4" aria-hidden="true" /> New Category
          </Button>
        </div>
      </div>

      <p className="rounded-xl border border-[#E5B842]/25 bg-[#E5B842]/5 p-3 text-xs leading-relaxed text-[#C9B26A]">
        💡 Slugs are permanent (products point to them). Hide a category with the eye toggle to pull it off the
        storefront without touching its products — deleting is only possible when no product uses it.
      </p>

      <div className="glass rounded-2xl p-4 md:p-5">
        {loading ? (
          <div className="space-y-2">
            {([0, 1, 2, 3, 4] as const).map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Tags className="size-10 text-[#9AA89E]" aria-hidden="true" />
            <div>
              <p className="font-medium">No categories found</p>
              <p className="text-sm text-[#9AA89E]">Create your first custom category for this zone.</p>
            </div>
            <Button variant="outline" className="h-10" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> New Category
            </Button>
          </div>
        ) : (
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-[#9AA89E]">Order</TableHead>
                <TableHead className="text-[#9AA89E]">Category</TableHead>
                <TableHead className="text-[#9AA89E]">Zone</TableHead>
                <TableHead className="text-[#9AA89E]">Products</TableHead>
                <TableHead className="text-[#9AA89E]">Visible</TableHead>
                <TableHead className="text-right text-[#9AA89E]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((cat) => (
                <TableRow key={cat.id} className="border-white/10">
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="w-6 text-center font-mono text-xs text-[#9AA89E]">{cat.sortOrder}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-9"
                        disabled={busyId === cat.id}
                        onClick={() => void move(cat, -1)}
                        aria-label={`Move ${cat.label} up`}
                      >
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-9"
                        disabled={busyId === cat.id}
                        onClick={() => void move(cat, 1)}
                        aria-label={`Move ${cat.label} down`}
                      >
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-lg"
                        aria-hidden="true"
                      >
                        {cat.emoji}
                      </span>
                      <div className="min-w-0">
                        <p className={`max-w-[220px] truncate text-sm font-medium ${cat.active ? '' : 'text-[#9AA89E] line-through'}`}>
                          {cat.label}
                        </p>
                        <p className="max-w-[220px] truncate font-mono text-xs text-[#9AA89E]">/{cat.slug}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ZoneBadge zone={cat.zone} />
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Package className="size-3.5 text-[#9AA89E]" aria-hidden="true" />
                      {cat.productCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={cat.active}
                        disabled={busyId === cat.id}
                        onCheckedChange={() => void toggleActive(cat)}
                        aria-label={`${cat.active ? 'Hide' : 'Show'} ${cat.label}`}
                      />
                      {cat.active ? (
                        <Eye className="size-3.5 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <EyeOff className="size-3.5 text-[#9AA89E]" aria-hidden="true" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-9" aria-label={`Actions for ${cat.label}`}>
                          {busyId === cat.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-white/15 bg-[#101512]">
                        <DropdownMenuItem onClick={() => openEdit(cat)}>
                          <Pencil className="size-4" aria-hidden="true" /> Edit name / emoji
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void toggleActive(cat)}>
                          {cat.active ? (
                            <>
                              <EyeOff className="size-4" aria-hidden="true" /> Hide from storefront
                            </>
                          ) : (
                            <>
                              <Eye className="size-4" aria-hidden="true" /> Show on storefront
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(cat)}
                          className="text-red-400 focus:text-red-300"
                        >
                          <Trash2 className="size-4" aria-hidden="true" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Create / edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="max-w-lg border-white/15 bg-[#101512]">
          <DialogHeader>
            <DialogTitle className="text-[#F5F8F6]">
              {editing ? `Edit “${editing.label}”` : 'New category'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Slug and zone are permanent — products point to the slug. Name, emoji and description update everywhere instantly.'
                : 'The category goes live on the storefront the moment you save — chips, product form and journey slider included.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cat-zone" className="text-[#9AA89E]">Zone</Label>
                {editing ? (
                  <div className="mt-1.5"><ZoneBadge zone={editing.zone} /></div>
                ) : (
                  <Select value={form.zone} onValueChange={(v) => setForm((f) => ({ ...f, zone: v as Zone }))}>
                    <SelectTrigger id="cat-zone" className="mt-1.5 h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kids">🎨 Kids</SelectItem>
                      <SelectItem value="creator">🤖 Creator</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label htmlFor="cat-emoji" className="text-[#9AA89E]">Emoji</Label>
                <Input
                  id="cat-emoji"
                  value={form.emoji}
                  onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
                  placeholder="📦"
                  maxLength={16}
                  className="mt-1.5 h-10"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {EMOJI_PRESETS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                      className="flex size-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-sm transition-colors hover:border-[#E5B842]/50 hover:bg-[#E5B842]/10"
                      aria-label={`Use emoji ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="cat-label" className="text-[#9AA89E]">Name *</Label>
              <Input
                id="cat-label"
                value={form.label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Canva Templates"
                maxLength={40}
                className="mt-1.5 h-10"
              />
            </div>

            <div>
              <Label htmlFor="cat-slug" className="text-[#9AA89E]">Slug {editing && <span className="text-xs">(permanent)</span>}</Label>
              <Input
                id="cat-slug"
                value={editing ? editing.slug : slugPreview}
                onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))}
                placeholder="auto-generated from the name"
                disabled={Boolean(editing)}
                maxLength={40}
                className="mt-1.5 h-10 font-mono text-xs"
              />
              {!editing && (
                <p className="mt-1 text-[11px] text-[#9AA89E]">
                  URL-friendly id: lowercase letters, numbers, dashes. It is permanent after creation.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="cat-blurb" className="text-[#9AA89E]">Short description</Label>
              <Textarea
                id="cat-blurb"
                value={form.blurb}
                onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))}
                placeholder="One line shown on the journey card, e.g. 'Editable pro designs'"
                maxLength={120}
                rows={2}
                className="mt-1.5"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || form.label.trim().length < 2}
              className="bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {editing ? 'Save changes' : 'Create category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/15 bg-[#101512]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.productCount > 0
                ? `${deleteTarget.productCount} product${deleteTarget.productCount === 1 ? '' : 's'} still use${deleteTarget.productCount === 1 ? 's' : ''} this category — deletion will be refused. Reassign them first, or hide the category instead.`
                : 'This permanently removes the category from the storefront and product form. Products are not touched.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} className="bg-red-600 text-white hover:bg-red-500">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
