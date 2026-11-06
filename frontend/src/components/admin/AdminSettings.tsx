'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Settings: account security (T4-b), site-wide texts &
// toggles, review moderation and FAQ management.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import type { FaqItem, Review, SiteSettings, Zone } from '@/types/marketplace'
import { adminJson, type AdminSecurityInfo } from '@/lib/admin-api'
import AdminSecurity from '@/components/admin/AdminSecurity'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function ZoneChip({ zone }: { zone: Zone }) {
  return zone === 'kids' ? (
    <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-300">KIDS</Badge>
  ) : (
    <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-300">CREATOR</Badge>
  )
}

const EMPTY_REVIEW = {
  avatarEmoji: '🌟',
  name: '',
  role: '',
  content: '',
  rating: '5',
  zone: 'kids' as Zone,
  verified: true,
}

const EMPTY_FAQ = { question: '', answer: '', sortOrder: '' }

export default function AdminSettings({
  security,
  onSecurityChanged,
}: {
  security: AdminSecurityInfo | null
  onSecurityChanged: () => void
}) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null)
  const [newReview, setNewReview] = useState(EMPTY_REVIEW)
  const [addingReview, setAddingReview] = useState(false)
  const [faqs, setFaqs] = useState<FaqItem[] | null>(null)
  const [busyFaqId, setBusyFaqId] = useState<string | null>(null)
  const [newFaq, setNewFaq] = useState(EMPTY_FAQ)
  const [addingFaq, setAddingFaq] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [s, r, f] = await Promise.all([
          adminJson<{ settings: SiteSettings }>('/api/settings'),
          adminJson<{ reviews: Review[] }>('/api/reviews'),
          adminJson<{ faqs: FaqItem[] }>('/api/faqs'),
        ])
        if (!alive) return
        setSettings(s.settings)
        setReviews(r.reviews)
        setFaqs(f.faqs)
      } catch (err) {
        if (alive) {
          toast({ title: err instanceof Error ? err.message : 'Failed to load settings', variant: 'destructive' })
        }
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [toast])

  function upd(key: keyof SiteSettings) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setSettings((s) => (s ? { ...s, [key]: e.target.value } : s))
  }

  async function saveSettings() {
    if (!settings || savingSettings) return
    setSavingSettings(true)
    try {
      const d = await adminJson<{ settings: SiteSettings }>('/api/settings', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(settings),
      })
      setSettings(d.settings)
      toast({ title: 'Settings saved' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSavingSettings(false)
    }
  }

  async function addReview() {
    if (!newReview.name.trim() || !newReview.content.trim()) {
      toast({ title: 'Name and review text are required', variant: 'destructive' })
      return
    }
    setAddingReview(true)
    try {
      await adminJson<{ review: Review }>('/api/reviews', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: newReview.name.trim(),
          role: newReview.role.trim(),
          avatarEmoji: newReview.avatarEmoji.trim() || '🌟',
          content: newReview.content.trim(),
          rating: parseInt(newReview.rating, 10) || 5,
          zone: newReview.zone,
          verified: newReview.verified,
          sortOrder: reviews?.length ?? 0,
        }),
      })
      const d = await adminJson<{ reviews: Review[] }>('/api/reviews')
      setReviews(d.reviews)
      setNewReview(EMPTY_REVIEW)
      toast({ title: 'Review added' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add review', variant: 'destructive' })
    } finally {
      setAddingReview(false)
    }
  }

  async function deleteReview(id: string) {
    setBusyReviewId(id)
    try {
      await adminJson<{ [key: string]: never }>(`/api/reviews?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setReviews((list) => (list ? list.filter((r) => r.id !== id) : list))
      toast({ title: 'Review deleted' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Delete failed', variant: 'destructive' })
    } finally {
      setBusyReviewId(null)
    }
  }

  async function addFaq() {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) {
      toast({ title: 'Question and answer are required', variant: 'destructive' })
      return
    }
    setAddingFaq(true)
    try {
      await adminJson<{ faq: FaqItem }>('/api/faqs', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          question: newFaq.question.trim(),
          answer: newFaq.answer.trim(),
          sortOrder: parseInt(newFaq.sortOrder, 10) || (faqs?.length ?? 0),
        }),
      })
      const d = await adminJson<{ faqs: FaqItem[] }>('/api/faqs')
      setFaqs(d.faqs)
      setNewFaq(EMPTY_FAQ)
      toast({ title: 'FAQ added' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add FAQ', variant: 'destructive' })
    } finally {
      setAddingFaq(false)
    }
  }

  async function deleteFaq(id: string) {
    setBusyFaqId(id)
    try {
      await adminJson<{ [key: string]: never }>(`/api/faqs?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setFaqs((list) => (list ? list.filter((f) => f.id !== id) : list))
      toast({ title: 'FAQ deleted' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Delete failed', variant: 'destructive' })
    } finally {
      setBusyFaqId(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* ── 0) Account security (T4-b) ── */}
      <AdminSecurity security={security} onChanged={onSecurityChanged} />

      <header>
        <h2 className="font-cinzel text-xl text-[#E5B842]">Settings</h2>
        <p className="text-sm text-[#9AA89E]">Site copy, payment details, social proof and FAQs.</p>
      </header>

      {/* ── a) Site settings ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Site Settings</h3>
        {!settings ? (
          <div className="mt-4 space-y-3">
            {([0, 1, 2, 3] as const).map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tickerKids">Kids ticker text</Label>
                <Input id="tickerKids" value={settings.tickerKidsText} onChange={upd('tickerKidsText')} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="tickerCreator">Creator ticker text</Label>
                <Input id="tickerCreator" value={settings.tickerCreatorText} onChange={upd('tickerCreatorText')} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="tickerAssets">Assets ticker text</Label>
                <Input id="tickerAssets" value={settings.tickerAssetsText} onChange={upd('tickerAssetsText')} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="announcement">Announcement banner</Label>
                <Input
                  id="announcement"
                  value={settings.announcementBanner}
                  onChange={upd('announcementBanner')}
                  placeholder="Leave empty to hide"
                  className="mt-1.5 h-10"
                />
              </div>
              <div>
                <Label htmlFor="upiId">UPI ID</Label>
                <Input id="upiId" value={settings.upiId} onChange={upd('upiId')} placeholder="name@upi" className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="upiPayee">UPI payee name</Label>
                <Input id="upiPayee" value={settings.upiPayeeName} onChange={upd('upiPayeeName')} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="promoCode">Promo code</Label>
                <Input id="promoCode" value={settings.promoCode} onChange={upd('promoCode')} className="mt-1.5 h-10" />
              </div>
              <div>
                <Label htmlFor="contactEmail">Contact email</Label>
                <Input id="contactEmail" type="email" value={settings.contactEmail} onChange={upd('contactEmail')} className="mt-1.5 h-10" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="siteTagline">Site tagline</Label>
                <Textarea
                  id="siteTagline"
                  rows={2}
                  value={settings.siteTagline}
                  onChange={upd('siteTagline')}
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-6">
              <label className="flex items-center gap-3">
                <Switch
                  checked={settings.instantDownloadEnabled}
                  onCheckedChange={(v) => setSettings((s) => (s ? { ...s, instantDownloadEnabled: v } : s))}
                  aria-label="Toggle instant download globally"
                />
                <span className="text-sm">⚡ Instant download enabled</span>
              </label>
              <label className="flex items-center gap-3">
                <Switch
                  checked={settings.soundEnabled}
                  onCheckedChange={(v) => setSettings((s) => (s ? { ...s, soundEnabled: v } : s))}
                  aria-label="Toggle site sound effects"
                />
                <span className="text-sm">🔊 Sound effects on</span>
              </label>
            </div>

            <Button
              onClick={() => void saveSettings()}
              disabled={savingSettings}
              className="mt-5 h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {savingSettings ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              Save Settings
            </Button>
          </>
        )}
      </section>

      {/* ── b) Reviews manager ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Reviews Manager</h3>
        {!reviews ? (
          <div className="mt-4 space-y-2">
            {([0, 1, 2] as const).map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <p className="mt-4 text-sm text-[#9AA89E]">No reviews yet — add one below.</p>
        ) : (
          <div className="nice-scroll mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {reviews.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
                <span className="text-xl" aria-hidden="true">
                  {r.avatarEmoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <span className="text-xs text-[#9AA89E]">{r.role}</span>
                    <ZoneChip zone={r.zone} />
                    <span className="text-xs text-[#E5B842]" aria-label={`${r.rating} out of 5 stars`}>
                      {'★'.repeat(r.rating)}
                    </span>
                    {r.verified && <span className="text-[10px] font-medium text-emerald-400">✓ verified</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-[#9AA89E]">{r.content}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 hover:text-red-300"
                  disabled={busyReviewId === r.id}
                  onClick={() => void deleteReview(r.id)}
                  aria-label={`Delete review by ${r.name}`}
                >
                  {busyReviewId === r.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add review */}
        <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-white/15 p-4 sm:grid-cols-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9AA89E] sm:col-span-2">Add a review</p>
          <div className="flex gap-2">
            <div className="w-20">
              <Label htmlFor="revEmoji">Emoji</Label>
              <Input
                id="revEmoji"
                value={newReview.avatarEmoji}
                onChange={(e) => setNewReview((r) => ({ ...r, avatarEmoji: e.target.value }))}
                maxLength={4}
                className="mt-1.5 h-10 text-center"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="revName">Name</Label>
              <Input
                id="revName"
                value={newReview.name}
                onChange={(e) => setNewReview((r) => ({ ...r, name: e.target.value }))}
                placeholder="Priya M."
                className="mt-1.5 h-10"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="revRole">Role</Label>
            <Input
              id="revRole"
              value={newReview.role}
              onChange={(e) => setNewReview((r) => ({ ...r, role: e.target.value }))}
              placeholder="Mom of a 5-year-old"
              className="mt-1.5 h-10"
            />
          </div>
          <div>
            <Label htmlFor="revRating">Rating</Label>
            <Select value={newReview.rating} onValueChange={(v) => setNewReview((r) => ({ ...r, rating: v }))}>
              <SelectTrigger id="revRating" className="mt-1.5 h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {([5, 4, 3, 2, 1] as const).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {'★'.repeat(n)} ({n})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="revZone">Zone</Label>
            <Select
              value={newReview.zone}
              onValueChange={(v) => setNewReview((r) => ({ ...r, zone: v as Zone }))}
            >
              <SelectTrigger id="revZone" className="mt-1.5 h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kids">🎨 Kids</SelectItem>
                <SelectItem value="creator">🤖 Creator</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="revContent">Review</Label>
            <Textarea
              id="revContent"
              rows={2}
              value={newReview.content}
              onChange={(e) => setNewReview((r) => ({ ...r, content: e.target.value }))}
              placeholder="What did they love about it?"
              className="mt-1.5"
            />
          </div>
          <label className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={newReview.verified}
              onCheckedChange={(v) => setNewReview((r) => ({ ...r, verified: v }))}
              aria-label="Mark review as verified"
            />
            <span className="text-sm">Verified buyer</span>
          </label>
          <div className="sm:col-span-2">
            <Button onClick={() => void addReview()} disabled={addingReview} className="h-10 w-full sm:w-auto">
              {addingReview ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Add Review
            </Button>
          </div>
        </div>
      </section>

      {/* ── c) FAQ manager ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">FAQ Manager</h3>
        {!faqs ? (
          <div className="mt-4 space-y-2">
            {([0, 1, 2] as const).map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : faqs.length === 0 ? (
          <p className="mt-4 text-sm text-[#9AA89E]">No FAQs yet — add the first one below.</p>
        ) : (
          <div className="nice-scroll mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {faqs.map((f) => (
              <div key={f.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <span className="mr-1.5 font-mono text-xs text-[#9AA89E]">#{f.sortOrder}</span>
                    {f.question}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[#9AA89E]">{f.answer}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 hover:text-red-300"
                  disabled={busyFaqId === f.id}
                  onClick={() => void deleteFaq(f.id)}
                  aria-label={`Delete FAQ: ${f.question}`}
                >
                  {busyFaqId === f.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add FAQ */}
        <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-white/15 p-4 sm:grid-cols-[1fr_120px]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9AA89E] sm:col-span-2">Add an FAQ</p>
          <div>
            <Label htmlFor="faqQ">Question</Label>
            <Input
              id="faqQ"
              value={newFaq.question}
              onChange={(e) => setNewFaq((f) => ({ ...f, question: e.target.value }))}
              placeholder="How do I download my files?"
              className="mt-1.5 h-10"
            />
          </div>
          <div>
            <Label htmlFor="faqOrder">Sort order</Label>
            <Input
              id="faqOrder"
              type="number"
              value={newFaq.sortOrder}
              onChange={(e) => setNewFaq((f) => ({ ...f, sortOrder: e.target.value }))}
              placeholder="Auto"
              className="mt-1.5 h-10"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="faqA">Answer</Label>
            <Textarea
              id="faqA"
              rows={2}
              value={newFaq.answer}
              onChange={(e) => setNewFaq((f) => ({ ...f, answer: e.target.value }))}
              placeholder="Right after payment you get an email with the download link…"
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void addFaq()} disabled={addingFaq} className="h-10 w-full sm:w-auto">
              {addingFaq ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Add FAQ
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
