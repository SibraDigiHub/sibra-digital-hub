'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Social Media Channels (T-V Feature A): admin-managed,
// zone-scoped channel directory. Add / edit / delete / reorder
// / on-off — nothing hard-coded; the storefront picks changes
// up within the 60s public cache (instant for admin sessions).
// Safety: ONLY official platform links are accepted (server
// re-validates per platform); logo upload reuses the existing
// ImageKit media flow.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Upload,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { OTHER_PLATFORM_ID, SOCIAL_PLATFORM_IDS, platformLabel, platformMeta } from '@/lib/social-platforms'
import PlatformGlyph from '@/components/shop/PlatformGlyph'
import type { Zone } from '@/types/marketplace'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface AdminChannel {
  id: string
  zone: Zone
  /** Known platform id, or the admin-defined "Other" platform name. */
  platform: string
  name: string
  url: string
  handle: string | null
  logo: string | null
  description: string | null
  audienceTag: string | null
  buttonText: string
  sortOrder: number
  enabled: boolean
}

type ZoneFilter = 'all' | Zone

interface FormState {
  zone: Zone
  /** Selected dropdown value — a known platform id, or OTHER_PLATFORM_ID. */
  platform: string
  /** Display name typed for "Other"; stored as the platform value. */
  customPlatform: string
  name: string
  url: string
  handle: string
  logo: string
  description: string
  audienceTag: string
  buttonText: string
  sortOrder: number
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  zone: 'kids',
  platform: 'youtube',
  customPlatform: '',
  name: '',
  url: '',
  handle: '',
  logo: '',
  description: '',
  audienceTag: '',
  buttonText: 'Subscribe',
  sortOrder: 0,
  enabled: true,
}

function ZoneBadge({ zone }: { zone: Zone }) {
  return zone === 'kids' ? (
    <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-300">KIDS</Badge>
  ) : (
    <Badge className="border-cyan-400/40 bg-cyan-400/10 text-cyan-300">CREATOR</Badge>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <Badge className="gap-1 border-white/15 bg-white/5 text-[#C9D2CB]" aria-label={`Platform: ${platformLabel(platform)}`}>
      <PlatformGlyph platform={platform} className="size-3" />
      {platformLabel(platform)}
    </Badge>
  )
}

/** Browser → ImageKit direct upload (same flow as the product form). */
async function uploadLogo(file: File): Promise<{ url: string }> {
  const authRes = await adminFetch('/api/imagekit/auth?kind=media')
  const auth = (await authRes.json().catch(() => null)) as {
    token?: string
    signature?: string
    expire?: string | number
    publicKey?: string
    fallback?: boolean
  } | null
  if (!authRes.ok || !auth?.signature || !auth?.token || !auth?.publicKey) {
    throw new Error(auth?.fallback ? 'ImageKit is not configured — paste a logo URL instead.' : 'Upload signing failed.')
  }
  const fd = new FormData()
  fd.set('file', file)
  fd.set('fileName', file.name)
  fd.set('folder', 'public-media/channels')
  fd.set('token', auth.token)
  fd.set('signature', auth.signature)
  fd.set('expire', String(auth.expire))
  fd.set('publicKey', auth.publicKey)
  const upRes = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: fd })
  const up = (await upRes.json().catch(() => null)) as { url?: string; message?: string } | null
  if (!upRes.ok || !up?.url) throw new Error(up?.message ?? 'ImageKit upload failed')
  return { url: up.url }
}

export default function AdminChannels() {
  const { toast } = useToast()
  const [channels, setChannels] = useState<AdminChannel[] | null>(null)
  const [filter, setFilter] = useState<ZoneFilter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminChannel | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<AdminChannel | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/channels')
      const data = (await res.json().catch(() => null)) as { channels?: AdminChannel[] } | null
      setChannels(Array.isArray(data?.channels) ? data.channels : [])
    } catch {
      setChannels([])
    }
  }, [])

  useEffect(() => {
    // Deferred boot-fetch (keeps the effect body free of sync state updates)
    const t = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [load])

  const shown = (channels ?? []).filter((c) => filter === 'all' || c.zone === filter)

  const isCustomPlatform = form.platform === OTHER_PLATFORM_ID
  const platformName = isCustomPlatform ? form.customPlatform.trim() || 'Other' : platformLabel(form.platform)
  const urlMeta = isCustomPlatform ? platformMeta(OTHER_PLATFORM_ID) : platformMeta(form.platform)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (c: AdminChannel) => {
    setEditing(c)
    const known = (SOCIAL_PLATFORM_IDS as readonly string[]).includes(c.platform)
    setForm({
      zone: c.zone,
      platform: known ? c.platform : OTHER_PLATFORM_ID,
      customPlatform: known ? '' : c.platform,
      name: c.name,
      url: c.url,
      handle: c.handle ?? '',
      logo: c.logo ?? '',
      description: c.description ?? '',
      audienceTag: c.audienceTag ?? '',
      buttonText: c.buttonText || 'Subscribe',
      sortOrder: c.sortOrder,
      enabled: c.enabled,
    })
    setDialogOpen(true)
  }

  const handleLogoUpload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url } = await uploadLogo(file)
      setForm((f) => ({ ...f, logo: url }))
      toast({ title: 'Logo uploaded' })
    } catch (e) {
      toast({ title: 'Upload failed', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    const customName = form.customPlatform.trim()
    if (isCustomPlatform && !customName) {
      toast({ title: 'Enter the platform name for Other', variant: 'destructive' })
      return
    }
    if (!form.name.trim() || !form.url.trim()) {
      toast({ title: 'Name and page link are required', variant: 'destructive' })
      return
    }
    if (form.description.length > 120) {
      toast({ title: 'Description is over 120 characters', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        zone: form.zone,
        platform: isCustomPlatform ? customName : form.platform,
        name: form.name.trim(),
        url: form.url.trim(),
        handle: form.handle.trim() || null,
        logo: form.logo.trim() || null,
        description: form.description.trim() || null,
        audienceTag: form.audienceTag.trim() || null,
        buttonText: form.buttonText.trim() || 'Subscribe',
        sortOrder: Number(form.sortOrder) || 0,
        enabled: form.enabled,
      }
      const res = await adminFetch(editing ? `/api/admin/channels/${editing.id}` : '/api/admin/channels', {
        method: editing ? 'PATCH' : 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => null)) as { channel?: AdminChannel; error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      toast({ title: editing ? 'Channel updated' : 'Channel added' })
      setDialogOpen(false)
      await load()
    } catch (e) {
      toast({
        title: 'Could not save channel',
        description: e instanceof Error ? e.message : 'Only official platform links are allowed.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (c: AdminChannel) => {
    setBusyId(c.id)
    try {
      const res = await adminFetch(`/api/admin/channels/${c.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ enabled: !c.enabled }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      toast({ title: 'Could not update the channel', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const move = async (c: AdminChannel, dir: -1 | 1) => {
    setBusyId(c.id)
    try {
      const res = await adminFetch(`/api/admin/channels/${c.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ sortOrder: Math.max(0, c.sortOrder + dir) }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      toast({ title: 'Reorder failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      const res = await adminFetch(`/api/admin/channels/${deleting.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ title: 'Channel deleted' })
      await load()
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' })
    } finally {
      setBusyId(null)
      setDeleting(null)
    }
  }

  if (channels === null) {
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
          <Share2 className="size-5 text-[#FF6B6B]" aria-hidden="true" />
          <h1 className="font-baloo text-xl font-extrabold text-[#F5F8F6]">Social Media Channels</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as ZoneFilter)}>
            <SelectTrigger className="h-10 w-[150px] border-white/15 bg-white/5 text-[#F5F8F6]" aria-label="Filter by zone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              <SelectItem value="kids">Kids Zone</SelectItem>
              <SelectItem value="creator">Creator Hub</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={openCreate} className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c75a]">
            <Plus className="size-4" aria-hidden="true" /> Add channel
          </Button>
        </div>
      </div>

      <p className="text-xs text-[#9AA89E]">
        Channels appear only inside their own zone — shop section, navbar icon, footer and the thank-you page. Only
        official platform links are accepted (YouTube, Instagram, Pinterest, Facebook, X, WhatsApp, Telegram — or pick
        Other and name any platform); logos are uploaded through the site&apos;s image storage. No videos are embedded
        here — just our logo and a safe link.
      </p>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-[#9AA89E]">
          No channels {filter === 'all' ? 'yet' : `in this zone`} — the storefront simply hides the section until you
          add one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="w-[54px] text-[#9AA89E]">Logo</TableHead>
                <TableHead className="text-[#9AA89E]">Channel</TableHead>
                <TableHead className="text-[#9AA89E]">Zone</TableHead>
                <TableHead className="w-[70px] text-[#9AA89E]">Order</TableHead>
                <TableHead className="w-[110px] text-[#9AA89E]">Visible</TableHead>
                <TableHead className="w-[120px] text-right text-[#9AA89E]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id} className="border-white/10">
                  <TableCell>
                    {c.logo ? (
                      <img src={c.logo} alt="" aria-hidden="true" className="size-10 rounded-lg object-contain ring-1 ring-white/10" />
                    ) : (
                      <span className="grid size-10 place-items-center rounded-lg bg-[#FF0000]/10 text-[#FF6B6B]">
                        <PlatformGlyph platform={c.platform} className="size-5" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#F5F8F6]">{c.name}</p>
                      <p className="truncate font-mono text-[11px] text-[#9AA89E]">
                        {c.handle ? `@${c.handle} · ` : ''}
                        {c.audienceTag ?? c.buttonText}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ZoneBadge zone={c.zone} />
                      <PlatformBadge platform={c.platform} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => void move(c, -1)}
                        disabled={busyId === c.id}
                        aria-label={`Move ${c.name} earlier`}
                        className="grid size-7 place-items-center rounded text-[#9AA89E] hover:bg-white/5 hover:text-[#F5F8F6] disabled:opacity-40"
                      >
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                      </button>
                      <span className="w-5 text-center font-mono text-xs text-[#F5F8F6]">{c.sortOrder}</span>
                      <button
                        type="button"
                        onClick={() => void move(c, 1)}
                        disabled={busyId === c.id}
                        aria-label={`Move ${c.name} later`}
                        className="grid size-7 place-items-center rounded text-[#9AA89E] hover:bg-white/5 hover:text-[#F5F8F6] disabled:opacity-40"
                      >
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={c.enabled}
                      onCheckedChange={() => void toggleEnabled(c)}
                      disabled={busyId === c.id}
                      aria-label={`Toggle ${c.name} visibility`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        aria-label={`Edit ${c.name}`}
                        className="grid size-9 place-items-center rounded-lg text-[#9AA89E] hover:bg-white/5 hover:text-[#F5F8F6]"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(c)}
                        aria-label={`Delete ${c.name}`}
                        className="grid size-9 place-items-center rounded-lg text-[#9AA89E] hover:bg-red-500/10 hover:text-red-300"
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

      {/* ── Create / edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto border-[rgba(229,184,66,0.25)] bg-[#0B0E0D] text-[#F5F8F6]">
          <DialogHeader>
            <DialogTitle className="font-baloo">{editing ? 'Edit channel' : 'Add a social media channel'}</DialogTitle>
            <DialogDescription className="text-[#9AA89E]">
              It will show up only in the chosen zone. Official platform links only — the server checks each link
              against the selected platform.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ch-zone" className="text-[#9AA89E]">Zone</Label>
                <Select value={form.zone} onValueChange={(v) => setForm((f) => ({ ...f, zone: v as Zone }))}>
                  <SelectTrigger id="ch-zone" className="border-white/15 bg-white/5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kids">Kids Zone</SelectItem>
                    <SelectItem value="creator">Creator Hub</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ch-order" className="text-[#9AA89E]">Order number</Label>
                <Input
                  id="ch-order"
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
                  className="border-white/15 bg-white/5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ch-platform" className="text-[#9AA89E]">Platform</Label>
              <Select
                value={form.platform}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    platform: v,
                    customPlatform: v === OTHER_PLATFORM_ID ? f.customPlatform : '',
                  }))
                }
              >
                <SelectTrigger id="ch-platform" className="border-white/15 bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOCIAL_PLATFORM_IDS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {platformLabel(p)}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_PLATFORM_ID}>Other (custom)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isCustomPlatform && (
              <div className="space-y-1.5">
                <Label htmlFor="ch-platform-name" className="text-[#9AA89E]">Platform name *</Label>
                <Input
                  id="ch-platform-name"
                  value={form.customPlatform}
                  onChange={(e) => setForm((f) => ({ ...f, customPlatform: e.target.value }))}
                  placeholder="e.g. Snapchat, LinkedIn, Moj"
                  maxLength={40}
                  className="border-white/15 bg-white/5"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ch-name" className="text-[#9AA89E]">Channel name *</Label>
              <Input
                id="ch-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Sibra Kids & Buddy"
                maxLength={80}
                className="border-white/15 bg-white/5"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ch-url" className="text-[#9AA89E]">{platformName} link *</Label>
              <Input
                id="ch-url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder={urlMeta.placeholder}
                className="border-white/15 bg-white/5"
              />
              <p className="text-[11px] text-[#9AA89E]">{urlMeta.hint}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ch-handle" className="text-[#9AA89E]">Handle (optional)</Label>
                <Input
                  id="ch-handle"
                  value={form.handle}
                  onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
                  placeholder="@yourchannel"
                  maxLength={40}
                  className="border-white/15 bg-white/5"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ch-audience" className="text-[#9AA89E]">Audience tag (optional)</Label>
                <Input
                  id="ch-audience"
                  value={form.audienceTag}
                  onChange={(e) => setForm((f) => ({ ...f, audienceTag: e.target.value }))}
                  placeholder="Ages 2–6"
                  maxLength={40}
                  className="border-white/15 bg-white/5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ch-desc" className="text-[#9AA89E]">
                Short description <span className={form.description.length > 120 ? 'text-red-400' : ''}>({form.description.length}/120)</span>
              </Label>
              <Textarea
                id="ch-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Nursery rhymes, alphabet, counting, colours and shapes."
                maxLength={140}
                rows={2}
                className="border-white/15 bg-white/5"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ch-btn" className="text-[#9AA89E]">Button text</Label>
                <Input
                  id="ch-btn"
                  value={form.buttonText}
                  onChange={(e) => setForm((f) => ({ ...f, buttonText: e.target.value }))}
                  placeholder="Subscribe"
                  maxLength={24}
                  className="border-white/15 bg-white/5"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[#9AA89E]">Visible on site</Label>
                <div className="flex h-10 items-center gap-2">
                  <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} aria-label="Channel visible" />
                  <span className="flex items-center gap-1 text-xs text-[#9AA89E]">
                    {form.enabled ? <Eye className="size-3.5" aria-hidden="true" /> : <EyeOff className="size-3.5" aria-hidden="true" />}
                    {form.enabled ? 'Shown' : 'Hidden'}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#9AA89E]">Channel logo</Label>
              <div className="flex items-center gap-3">
                {form.logo ? (
                  <img src={form.logo} alt="Channel logo preview" className="size-14 rounded-xl object-contain ring-1 ring-white/15" />
                ) : (
                  <span className="grid size-14 place-items-center rounded-xl bg-white/5 text-[#9AA89E]">
                    <PlatformGlyph platform={form.platform} className="size-6" />
                  </span>
                )}
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="ch-logo" className="cursor-pointer">
                    <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold hover:bg-white/10">
                      <Upload className="size-3.5" aria-hidden="true" />
                      {uploading ? 'Uploading…' : 'Upload logo'}
                    </span>
                  </Label>
                  <input
                    id="ch-logo"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => void handleLogoUpload(e.target.files)}
                    disabled={uploading}
                  />
                  <Input
                    value={form.logo}
                    onChange={(e) => setForm((f) => ({ ...f, logo: e.target.value }))}
                    placeholder="…or paste an image URL"
                    className="h-8 border-white/15 bg-white/5 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-white/15 bg-transparent text-[#F5F8F6] hover:bg-white/5">
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || uploading} className="bg-[#E5B842] font-semibold text-black hover:bg-[#f0c75a]">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {editing ? 'Save changes' : 'Add channel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="border-[rgba(229,184,66,0.25)] bg-[#0B0E0D] text-[#F5F8F6]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#9AA89E]">
              The channel disappears from the storefront immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-[#F5F8F6] hover:bg-white/5">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDelete()} className="bg-red-600 text-white hover:bg-red-500">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}