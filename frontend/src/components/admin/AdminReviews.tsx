'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Verified-purchase review moderation (Layer 2).
// Every buyer review lands here as 'pending'; approve → it
// appears on the product page (and the ⭐ card pill) within the
// 60s public cache; reject → it stays off the site but visible
// here; delete → gone for good. All decisions are audit-logged.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Star, Trash2, X } from 'lucide-react'

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { AdminProductReview } from '@/types/marketplace'

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

const STATUS_BADGE: Record<string, string> = {
  pending: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  rejected: 'border-red-500/40 bg-red-500/15 text-red-300',
}

function StarRow({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('size-3.5', n <= value ? 'fill-[#E5B842] text-[#E5B842]' : 'text-white/25')}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

function reviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function AdminReviews() {
  const { toast } = useToast()
  const [reviews, setReviews] = useState<AdminProductReview[] | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AdminProductReview | null>(null)

  const load = useCallback(async (status: StatusFilter) => {
    try {
      const res = await adminFetch(`/api/admin/reviews/product?status=${status}`)
      const data = (await res.json().catch(() => null)) as { reviews?: AdminProductReview[] } | null
      setReviews(Array.isArray(data?.reviews) ? data.reviews : [])
    } catch {
      setReviews([])
    }
  }, [])

  useEffect(() => {
    // Deferred boot-fetch (keeps the effect body free of sync state updates)
    const t = setTimeout(() => {
      void load('pending')
    }, 0)
    return () => clearTimeout(t)
  }, [load])

  const changeFilter = (v: StatusFilter) => {
    setFilter(v)
    setReviews(null)
    void load(v)
  }

  const moderate = async (r: AdminProductReview, status: 'approved' | 'rejected') => {
    setBusyId(r.id)
    try {
      const res = await adminFetch(`/api/admin/reviews/product/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error)
      }
      toast({ title: status === 'approved' ? 'Review approved — it is now live' : 'Review rejected' })
      await load(filter)
    } catch (e) {
      toast({ title: 'Moderation failed', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      const res = await adminFetch(`/api/admin/reviews/product/${deleting.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ title: 'Review deleted' })
      await load(filter)
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
      setDeleting(null)
    }
  }

  if (reviews === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Star className="size-5 text-[#E5B842]" aria-hidden="true" />
          <h1 className="font-baloo text-xl font-extrabold text-[#F5F8F6]">Product Reviews</h1>
        </div>
        <Select value={filter} onValueChange={(v) => changeFilter(v as StatusFilter)}>
          <SelectTrigger className="h-10 w-[160px] border-white/15 bg-white/5 text-[#F5F8F6]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-[#9AA89E]">
        Only real buyers can submit a review (each paid order allows exactly one, via their private delivery link).
        Approved reviews appear on the product page and as the ⭐ pill on its shop card within the public cache window.
      </p>

      {reviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-[#9AA89E]">
          No {filter === 'all' ? '' : `${filter} `}reviews yet — buyers are invited from the thank-you page and the
          delivery email.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-[#9AA89E]">Review</TableHead>
                <TableHead className="text-[#9AA89E]">Product</TableHead>
                <TableHead className="w-[110px] text-[#9AA89E]">Status</TableHead>
                <TableHead className="w-[100px] text-[#9AA89E]">Date</TableHead>
                <TableHead className="w-[150px] text-right text-[#9AA89E]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((r) => (
                <TableRow key={r.id} className="border-white/10">
                  <TableCell>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#F5F8F6]">{r.name}</p>
                        <StarRow value={r.rating} />
                      </div>
                      {r.text && (
                        <p className="mt-1 max-w-md whitespace-pre-wrap text-xs leading-relaxed text-[#9AA89E]">{r.text}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.product ? (
                      <div className="min-w-0">
                        <p className="max-w-[220px] truncate text-sm font-medium">{r.product.title}</p>
                        <p className="max-w-[220px] truncate font-mono text-xs text-[#9AA89E]">/{r.product.slug}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-[#9AA89E]">Deleted product</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('border', STATUS_BADGE[r.status])}>{r.status.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-[#9AA89E]">{reviewDate(r.createdAt)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void moderate(r, 'approved')}
                        disabled={busyId === r.id}
                        aria-label={`Approve review by ${r.name}`}
                        className="grid size-9 place-items-center rounded-lg text-[#9AA89E] hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-40"
                      >
                        {busyId === r.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="size-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void moderate(r, 'rejected')}
                        disabled={busyId === r.id}
                        aria-label={`Reject review by ${r.name}`}
                        className="grid size-9 place-items-center rounded-lg text-[#9AA89E] hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-40"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(r)}
                        disabled={busyId === r.id}
                        aria-label={`Delete review by ${r.name}`}
                        className="grid size-9 place-items-center rounded-lg text-[#9AA89E] hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="border-[rgba(229,184,66,0.25)] bg-[#0B0E0D] text-[#F5F8F6]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-baloo">Delete this review?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#9AA89E]">
              {deleting?.name} rated {deleting?.product?.title ?? 'a deleted product'} {deleting?.rating}/5. This
              permanently removes the review — the buyer cannot submit a second one for the same order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-[#F5F8F6] hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void doDelete()}
              className="bg-red-500/90 text-white hover:bg-red-500"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
