'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Product editor (create + edit). Zone-dependent
// categories, media uploads, per-product checkout-button
// control (UPI / USD / marketplaces / instant email delivery)
// and a sticky live preview that shows exactly which buttons
// buyers will get on the live site.
// ═══════════════════════════════════════════════════════════

import { adminFetch } from '@/lib/admin-api'
import { hydrateCategories, useZoneCategories } from '@/lib/categories'
import { fetchUsdInrRate } from '@/lib/fx-rate'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Loader2,
  Plus,
  Save,
  Star,
  Upload,
  X,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { PLATFORMS, slugify } from '@/lib/platforms'
import { toYouTubeEmbedUrl, youTubeId } from '@/lib/video'
import { parseProduct } from '@/store/app-store'
import {
  categoriesForZone,
  categoryLabel,
  type License,
  type MediaType,
  type PlatformId,
  type Product,
  type ProductRow,
  type ProductStatus,
  type SpatialCoords,
  type Zone,
} from '@/types/marketplace'

const KIDS_DEFAULT_BRAND = 'Professor Sibra Naaz'
const CREATOR_DEFAULT_BRAND = 'Sibra Digital Hub'
const MAX_IMAGES = 8

interface FormState {
  title: string
  slug: string
  zone: Zone
  category: string
  authorBrand: string
  ageOrLevel: string
  priceUsd: string
  priceInr: string
  badge: string
  description: string
  whatsInside: string[]
  howToUse: string
  license: License
  mediaType: MediaType
  images: string[]
  videoPreviewUrl: string
  internationalOn: boolean
  internationalLink: string
  indiaOn: boolean
  indiaLink: string
  platformLinks: { platform: PlatformId; url: string }[]
  instantDownload: boolean
  deliverableUrl: string
  deliverableName: string
  // T-V: video delivery mode for instant-download products.
  deliveryMode: 'file' | 'external' | 'watch'
  fullVideoUrl: string
  watchTtlHours: string
  watchMaxConcurrent: string
  featured: boolean
  status: ProductStatus
  sortOrder: string
  tags: string
  fileFormats: string
  pageCount: string
}

type Spatial = SpatialCoords

function initForm(product: ProductRow | null): { form: FormState; spatial: Spatial } {
  if (!product) {
    return {
      form: {
        title: '',
        slug: '',
        zone: 'kids',
        category: categoriesForZone('kids')[0].slug,
        authorBrand: KIDS_DEFAULT_BRAND,
        ageOrLevel: '',
        priceUsd: '4.99',
        priceInr: '399',
        badge: 'New',
        description: '',
        whatsInside: [],
        howToUse: '',
        license: 'personal',
        mediaType: 'images',
        images: [],
        videoPreviewUrl: '',
        internationalOn: false,
        internationalLink: '',
        indiaOn: false,
        indiaLink: '',
        platformLinks: [],
        instantDownload: false,
        deliverableUrl: '',
        deliverableName: '',
        deliveryMode: 'file',
        fullVideoUrl: '',
        watchTtlHours: '',
        watchMaxConcurrent: '2',
        featured: false,
        status: 'draft',
        sortOrder: '0',
        tags: '',
        fileFormats: '',
        pageCount: '',
      },
      spatial: { x: 0, y: 0, z: 0 },
    }
  }
  const p = parseProduct({ ...product }) as unknown as Product
  const zone = (p.zone === 'creator' ? 'creator' : 'kids') as Zone
  const links = (p.platformLinks ?? []) as { platform: string; url: string }[]
  return {
    form: {
      title: p.title ?? '',
      slug: p.slug ?? '',
      zone,
      category: p.category || categoriesForZone(zone)[0].slug,
      authorBrand: p.authorBrand || (zone === 'creator' ? CREATOR_DEFAULT_BRAND : KIDS_DEFAULT_BRAND),
      ageOrLevel: p.ageOrLevel ?? '',
      priceUsd: String(p.priceUsd ?? 0),
      priceInr: String(p.priceInr ?? 0),
      badge: p.badge ?? '',
      description: p.description ?? '',
      whatsInside: (p.whatsInside ?? []) as string[],
      howToUse: p.howToUse ?? '',
      license: (p.license as License) ?? 'personal',
      mediaType: (p.mediaType as MediaType) ?? 'images',
      images: (p.images ?? []) as string[],
      videoPreviewUrl: (p as { videoPreviewUrl?: string | null }).videoPreviewUrl ?? '',
      internationalOn: Boolean(p.internationalLink),
      internationalLink: p.internationalLink ?? '',
      indiaOn: Boolean(p.indiaLink),
      indiaLink: p.indiaLink ?? '',
      platformLinks: links.map((l) => ({ platform: l.platform as PlatformId, url: l.url })),
      instantDownload: Boolean(p.instantDownload),
      deliverableUrl: p.deliverableUrl ?? '',
      deliverableName: p.deliverableName ?? '',
      deliveryMode: p.deliveryMode ?? 'file',
      fullVideoUrl: (p as { fullVideoUrl?: string | null }).fullVideoUrl ?? '',
      watchTtlHours: (p as { watchTtlHours?: number | null }).watchTtlHours != null ? String((p as { watchTtlHours?: number | null }).watchTtlHours) : '',
      watchMaxConcurrent: String((p as { watchMaxConcurrent?: number }).watchMaxConcurrent ?? 2),
      featured: Boolean(p.featured),
      status: (p.status as ProductStatus) ?? 'draft',
      sortOrder: String(p.sortOrder ?? 0),
      tags: ((p.tags ?? []) as string[]).join(', '),
      fileFormats: ((p.fileFormats ?? []) as string[]).join(', '),
      pageCount: p.pageCount != null ? String(p.pageCount) : '',
    },
    spatial: (p.spatialCoords ?? { x: 0, y: 0, z: 0 }) as Spatial,
  }
}

// Browser → ImageKit direct upload (PRD §13.3): fetch signed params from
// GET /api/imagekit/auth, then POST the file straight to ImageKit's upload
// endpoint — no server proxy, so large videos stream straight to the CDN.
async function uploadFile(file: File, folder: 'images' | 'video' | 'files'): Promise<{ url: string; name: string }> {
  // Step A — signed upload params (requires ImageKit credentials in .env)
  const authRes = await adminFetch('/api/imagekit/auth')
  const auth = (await authRes.json().catch(() => null)) as {
    token?: string
    expire?: number
    signature?: string
    publicKey?: string
  } | null
  if (!authRes.ok || !auth?.token || !auth?.expire || !auth?.signature || !auth?.publicKey) {
    throw new Error(
      'ImageKit is not configured — add IMAGEKIT_PRIVATE_KEY, NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY and NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT to .env, then restart the server',
    )
  }

  // Step B — upload directly to ImageKit with signature auth
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '_') || 'file'
  const fd = new FormData()
  fd.append('file', file)
  fd.append('fileName', safeName)
  fd.append('folder', `/${folder}`)
  fd.append('publicKey', auth.publicKey)
  fd.append('signature', auth.signature)
  fd.append('expire', String(auth.expire))
  fd.append('token', auth.token)
  const upRes = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: fd })
  const up = (await upRes.json().catch(() => null)) as { url?: string; name?: string; message?: string } | null
  if (!upRes.ok || !up?.url) throw new Error(up?.message ?? 'ImageKit upload failed')
  return { url: up.url, name: up.name ?? safeName }
}


// Private Cloudflare R2 multipart upload for paid PDF/ZIP deliverables.
// Browser receives short-lived presigned part URLs; R2 credentials stay backend-only.
const R2_DELIVERABLE_MAX_BYTES = 300 * 1024 * 1024
const R2_DELIVERABLE_PART_SIZE = 16 * 1024 * 1024
const R2_DELIVERABLE_CONCURRENCY = 3

type R2MultipartSession = {
  uploadToken: string
  uploadId: string
  objectKey: string
  fileName: string
  partSize: number
  maxParts: number
}

async function uploadDeliverableToR2(
  file: File,
): Promise<{ url: string; name: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['pdf', 'zip'].includes(extension)) {
    throw new Error('Only PDF and ZIP files are allowed.')
  }
  if (!file.size || file.size > R2_DELIVERABLE_MAX_BYTES) {
    throw new Error('File must be between 1 byte and 300 MiB.')
  }

  const mimeType = extension === 'pdf'
    ? 'application/pdf'
    : (
        ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
          .includes(file.type)
          ? file.type
          : 'application/zip'
      )

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const response = await adminFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null) as
      | (T & { error?: string })
      | null

    if (!response.ok || !data) {
      throw new Error(data?.error ?? `Upload request failed (${response.status}).`)
    }
    return data
  }

  let session: R2MultipartSession | null = null

  try {
    session = await postJson<R2MultipartSession>(
      '/api/admin/r2/multipart/create',
      {
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      },
    )

    if (
      !session.uploadToken ||
      !session.uploadId ||
      !session.objectKey ||
      !session.partSize ||
      session.partSize !== R2_DELIVERABLE_PART_SIZE
    ) {
      throw new Error('Backend returned invalid R2 upload details.')
    }

    const partCount = Math.ceil(file.size / session.partSize)
    if (partCount > session.maxParts || partCount > 19) {
      throw new Error('File requires too many upload parts.')
    }

    const signed = await postJson<{
      parts: Array<{ partNumber: number; url: string }>
    }>('/api/admin/r2/multipart/sign', {
      uploadToken: session.uploadToken,
      uploadId: session.uploadId,
      objectKey: session.objectKey,
      sizeBytes: file.size,
      partNumbers: Array.from({ length: partCount }, (_, index) => index + 1),
    })

    if (!Array.isArray(signed.parts) || signed.parts.length !== partCount) {
      throw new Error('Backend did not provide all signed upload parts.')
    }

    const urlByPart = new Map(
      signed.parts.map((part) => [part.partNumber, part.url]),
    )

    for (let startPart = 1; startPart <= partCount; startPart += R2_DELIVERABLE_CONCURRENCY) {
      const batch = Array.from(
        { length: Math.min(R2_DELIVERABLE_CONCURRENCY, partCount - startPart + 1) },
        (_, index) => startPart + index,
      )

      const results = await Promise.allSettled(batch.map(async (partNumber) => {
        const url = urlByPart.get(partNumber)
        if (!url) throw new Error(`Missing signed URL for part ${partNumber}.`)

        const start = (partNumber - 1) * session!.partSize
        const end = Math.min(start + session!.partSize, file.size)

        const response = await fetch(url, {
          method: 'PUT',
          body: file.slice(start, end),
          headers: { 'Content-Type': mimeType },
        })

        if (!response.ok) {
          throw new Error(`R2 upload failed for part ${partNumber} (${response.status}).`)
        }

        // R2 CORS must expose ETag; check it before asking the backend to complete.
        if (!response.headers.get('ETag')) {
          throw new Error(
            'R2 did not expose the ETag response header. Check bucket CORS settings.',
          )
        }
      }))

      // Wait for every in-flight part before the catch block attempts multipart abort.
      const failedPart = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (failedPart) throw failedPart.reason
    }

    const completed = await postJson<{
      deliverableUrl: string
      fileName: string
    }>('/api/admin/r2/multipart/complete', {
      uploadToken: session.uploadToken,
      uploadId: session.uploadId,
      objectKey: session.objectKey,
      sizeBytes: file.size,
    })

    if (!completed.deliverableUrl?.startsWith('r2:')) {
      throw new Error('Backend did not return a valid private R2 reference.')
    }

    return {
      url: completed.deliverableUrl,
      name: completed.fileName || session.fileName || file.name,
    }
  } catch (error) {
    if (session) {
      try {
        await postJson('/api/admin/r2/multipart/abort', {
          uploadToken: session.uploadToken,
          uploadId: session.uploadId,
          objectKey: session.objectKey,
          sizeBytes: file.size,
        })
      } catch {
        // Preserve the original upload error; incomplete uploads are also
        // covered by the bucket's incomplete-multipart lifecycle rule.
      }
    }
    throw error
  }
}

function priceText(form: FormState) {
  const usd = parseFloat(form.priceUsd)
  const inr = parseFloat(form.priceInr)
  return {
    usd: isNaN(usd) ? '$0.00' : `$${usd.toFixed(2)}`,
    inr: isNaN(inr) ? '₹0' : `₹${Math.round(inr)}`,
  }
}

/** Video frame for the live preview card: a YouTube link shows the video's
 *  own thumbnail (same-origin proxy — the same frame buyers see), a direct
 *  https file link shows its first frame. Null when no video is set. */
function previewVideoMedia(form: FormState): { kind: 'yt'; src: string } | { kind: 'file'; src: string } | null {
  if (form.mediaType !== 'video') return null
  const url = form.videoPreviewUrl.trim()
  if (!url) return null
  const id = youTubeId(url)
  if (id) return { kind: 'yt', src: `/api/video/thumb?v=${encodeURIComponent(id)}` }
  if (/^https:\/\//i.test(url)) return { kind: 'file', src: url }
  return null
}

function activePlatformMetas(form: FormState) {
  return PLATFORMS.filter((meta) => form.platformLinks.some((l) => l.platform === meta.id && l.url.trim()))
}

function PreviewBtn({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`flex h-9 items-center justify-center rounded-full border px-3 text-xs font-bold ${className ?? ''}`}>
      {children}
    </span>
  )
}

function KidsPreview({ form }: { form: FormState }) {
  const price = priceText(form)
  const img = form.images[0]
  const video = previewVideoMedia(form)
  const platforms = activePlatformMetas(form)
  const hasButtons =
    form.instantDownload ||
    (form.indiaOn && Boolean(form.indiaLink.trim())) ||
    (form.internationalOn && Boolean(form.internationalLink.trim())) ||
    platforms.length > 0
  return (
    <div className="clay-card relative p-4">
      {form.badge.trim() && (
        <span className="absolute -left-2 -top-2 rotate-[-6deg] rounded-lg bg-[#FFB347] px-2 py-0.5 text-[11px] font-extrabold text-[#4a2800] shadow-md">
          {form.badge}
        </span>
      )}
      {video?.kind === 'yt' ? (
        <img
          src={video.src}
          alt="Product video thumbnail"
          onError={(e) => {
            const el = e.currentTarget
            if (img && el.dataset.fallback !== '1') {
              el.dataset.fallback = '1'
              el.src = img
            }
          }}
          className="h-36 w-full rounded-2xl object-cover"
        />
      ) : video?.kind === 'file' ? (
        <video
          src={video.src}
          poster={img || undefined}
          muted
          playsInline
          preload="metadata"
          className="h-36 w-full rounded-2xl object-cover"
        />
      ) : img ? (
        <img src={img} alt="Product cover preview" className="h-36 w-full rounded-2xl object-cover" />
      ) : (
        <div className="flex h-36 w-full items-center justify-center rounded-2xl bg-[#fff2cc] text-3xl" aria-hidden="true">
          🎨
        </div>
      )}
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-baloo text-xl leading-tight text-[#4a3b2a]">{form.title.trim() || 'Untitled product'}</h4>
          <p className="truncate text-[11px] text-[#9c8465]">
            {form.authorBrand}
            {form.ageOrLevel ? ` · ${form.ageOrLevel}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-extrabold text-[#e28a00]">{price.inr}</p>
          <p className="text-[11px] text-[#9c8465]">{price.usd}</p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {form.instantDownload && (
          <PreviewBtn className="border-emerald-500/60 bg-emerald-500/20 text-emerald-800">⚡ Instant Download</PreviewBtn>
        )}
        {form.indiaOn && form.indiaLink.trim() && (
          <PreviewBtn className="border-[#e28a00] bg-[#FFB347] text-[#4a2800]">🇮🇳 UPI Checkout · {price.inr}</PreviewBtn>
        )}
        {form.internationalOn && form.internationalLink.trim() && (
          <PreviewBtn className="border-[#d9c9a8] bg-white text-[#4a3b2a]">🌍 Global Card · {price.usd}</PreviewBtn>
        )}
        {platforms.map((m) => (
          <PreviewBtn key={m.id} className="border-[#d9c9a8] bg-white/80 text-[#4a3b2a]">
            {m.emoji} {m.label}
          </PreviewBtn>
        ))}
        {!hasButtons && <p className="py-2 text-center text-[11px] text-[#9c8465]">No checkout buttons enabled yet</p>}
      </div>
    </div>
  )
}

function CreatorPreview({ form }: { form: FormState }) {
  const price = priceText(form)
  const video = previewVideoMedia(form)
  const platforms = activePlatformMetas(form)
  const tags = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const hasButtons =
    form.instantDownload ||
    (form.indiaOn && Boolean(form.indiaLink.trim())) ||
    (form.internationalOn && Boolean(form.internationalLink.trim())) ||
    platforms.length > 0
  return (
    <div className="rounded-2xl border border-cyan-400/30 bg-[#0A0E10] p-4 shadow-[0_0_30px_rgba(0,240,255,0.08)]">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded border border-cyan-400/30 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
              {t}
            </span>
          ))}
        </div>
      )}
      {video?.kind === 'yt' ? (
        <img
          src={video.src}
          alt="Product video thumbnail"
          onError={(e) => {
            const el = e.currentTarget
            const cover = form.images[0]
            if (cover && el.dataset.fallback !== '1') {
              el.dataset.fallback = '1'
              el.src = cover
            }
          }}
          className="mt-2 aspect-video w-full rounded-xl border border-cyan-400/20 object-cover"
        />
      ) : video?.kind === 'file' ? (
        <video
          src={video.src}
          poster={form.images[0] || undefined}
          muted
          playsInline
          preload="metadata"
          className="mt-2 aspect-video w-full rounded-xl border border-cyan-400/20 object-cover"
        />
      ) : form.images[0] ? (
        <img
          src={form.images[0]}
          alt="Product cover preview"
          className="mt-2 aspect-video w-full rounded-xl border border-cyan-400/20 object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="mt-2 flex aspect-video w-full items-center justify-center rounded-xl border border-cyan-400/20 bg-black/50 font-mono text-[10px] tracking-widest text-cyan-300/50"
        >
          ⬢ NO COVER YET
        </div>
      )}
      <h4 className="mt-2 text-lg font-semibold leading-tight text-[#E8F6F2]">{form.title.trim() || 'Untitled product'}</h4>
      <p className="mt-0.5 text-[11px] text-[#6fa7a0]">
        {form.authorBrand} · {categoryLabel(form.zone, form.category)}
      </p>
      <p className="mt-2 font-bold text-cyan-300">
        {price.inr} <span className="text-xs font-normal text-[#6fa7a0]">/ {price.usd}</span>
      </p>
      <div className="mt-3 space-y-1.5">
        {form.instantDownload && (
          <PreviewBtn className="border-emerald-400/50 bg-emerald-500/15 text-emerald-300">⚡ Instant Download</PreviewBtn>
        )}
        {form.indiaOn && form.indiaLink.trim() && (
          <PreviewBtn className="border-cyan-400/50 bg-cyan-400/10 text-cyan-200">🇮🇳 UPI · {price.inr}</PreviewBtn>
        )}
        {form.internationalOn && form.internationalLink.trim() && (
          <PreviewBtn className="border-pink-400/50 bg-pink-400/10 text-pink-200">🌍 Card · {price.usd}</PreviewBtn>
        )}
        {platforms.map((m) => (
          <PreviewBtn key={m.id} className={m.color}>
            {m.emoji} {m.label}
          </PreviewBtn>
        ))}
        {!hasButtons && <p className="py-2 text-center text-[11px] text-[#6fa7a0]">No checkout buttons enabled yet</p>}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-5">
      <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">{title}</h3>
      {hint && <p className="mt-1 text-xs text-[#9AA89E]">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

interface ProductFormProps {
  product: ProductRow | null
  onDone: (saved: boolean) => void
}

export default function ProductForm({ product, onDone }: ProductFormProps) {
  const { toast } = useToast()
  const [initial] = useState(() => initForm(product))
  const [form, setForm] = useState<FormState>(initial.form)
  const [slugTouched, setSlugTouched] = useState(Boolean(product))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [imgUploading, setImgUploading] = useState<string[]>([])
  const [videoUploading, setVideoUploading] = useState(false)
  const [deliverableUploading, setDeliverableUploading] = useState(false)
  const [imageUrl, setImageUrl] = useState('')

  const imgInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const cats = useZoneCategories(form.zone)

  // T10: make sure the admin-managed registry is loaded so the
  // category select shows categories the admin created (shared fetch).
  useEffect(() => {
    void hydrateCategories()
  }, [])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => {
      if (!e[key as string]) return e
      const next = { ...e }
      delete next[key as string]
      return next
    })
  }

  function errText(key: string) {
    return errors[key] ?? null
  }

  function changeZone(zone: Zone) {
    setForm((f) => ({
      ...f,
      zone,
      category: categoriesForZone(zone)[0].slug,
      authorBrand: zone === 'kids' ? KIDS_DEFAULT_BRAND : CREATOR_DEFAULT_BRAND,
    }))
  }

  const [converting, setConverting] = useState(false)

  // Live USD→INR auto-convert: fills the INR price at the current exchange
  // rate (whole rupees — the save path rounds to an integer anyway). No
  // pricing-psychology snapping: $1 at a ₹95 rate must become ₹95, not ₹99.
  // A failed lookup converts nothing — the admin types the INR price instead
  // of a stale guess.
  async function autoConvert() {
    const usd = parseFloat(form.priceUsd)
    if (isNaN(usd) || usd <= 0) {
      toast({ title: 'Enter a USD price first', variant: 'destructive' })
      return
    }
    setConverting(true)
    try {
      const rate = await fetchUsdInrRate()
      const inr = Math.max(1, Math.round(usd * rate))
      setField('priceInr', String(inr))
      toast({ title: `Live rate applied: $1 = ₹${rate.toFixed(2)}` })
    } catch {
      toast({ title: 'Live rate unavailable — enter the INR price manually', variant: 'destructive' })
    } finally {
      setConverting(false)
    }
  }

  // ── whatsInside bullets ──
  function addBullet() {
    setField('whatsInside', [...form.whatsInside, ''])
  }
  function updateBullet(i: number, value: string) {
    setField(
      'whatsInside',
      form.whatsInside.map((b, bi) => (bi === i ? value : b)),
    )
  }
  function removeBullet(i: number) {
    setField(
      'whatsInside',
      form.whatsInside.filter((_, bi) => bi !== i),
    )
  }

  // ── images ──
  function addImageUrl() {
    const url = imageUrl.trim()
    if (!url || form.images.length >= MAX_IMAGES) return
    setField('images', [...form.images, url])
    setImageUrl('')
  }
  function removeImage(i: number) {
    setField(
      'images',
      form.images.filter((_, ii) => ii !== i),
    )
  }
  function moveImage(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= form.images.length) return
    const next = [...form.images]
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    setField('images', next)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    const room = MAX_IMAGES - form.images.length - imgUploading.length
    if (room <= 0) {
      toast({ title: `Maximum ${MAX_IMAGES} images per product`, variant: 'destructive' })
      return
    }
    const take = files.slice(0, room)
    if (files.length > room) {
      toast({ title: `${files.length - room} image(s) skipped — max ${MAX_IMAGES}` })
    }
    setImgUploading((u) => [...u, ...take.map((f) => f.name)])
    for (const file of take) {
      try {
        const data = await uploadFile(file, 'images')
        setForm((f) =>
          f.images.length >= MAX_IMAGES ? f : { ...f, images: [...f.images, data.url] },
        )
      } catch (err) {
        toast({ title: `Upload failed: ${file.name}`, description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
      } finally {
        setImgUploading((u) => u.filter((n) => n !== file.name))
      }
    }
  }

  async function handleVideoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: 'Video too large — keep it under ~100 MB', variant: 'destructive' })
      return
    }
    setVideoUploading(true)
    try {
      const data = await uploadFile(file, 'video')
      setField('videoPreviewUrl', data.url)
      toast({ title: 'Video uploaded' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Video upload failed', variant: 'destructive' })
    } finally {
      setVideoUploading(false)
    }
  }

  async function handleDeliverableUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setDeliverableUploading(true)
    try {
      const data = await uploadDeliverableToR2(file)
      setForm((f) => ({ ...f, deliverableUrl: data.url, deliverableName: data.name || file.name }))
      setErrors((er) => {
        const next = { ...er }
        delete next.deliverable
        return next
      })
      toast({ title: 'Deliverable attached' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Upload failed', variant: 'destructive' })
    } finally {
      setDeliverableUploading(false)
    }
  }

  // ── platform links ──
  function togglePlatform(id: PlatformId, checked: boolean) {
    setForm((f) => {
      const others = f.platformLinks.filter((l) => l.platform !== id)
      return { ...f, platformLinks: checked ? [...others, { platform: id, url: '' }] : others }
    })
  }
  function setPlatformUrl(id: PlatformId, url: string) {
    setForm((f) => ({
      ...f,
      platformLinks: f.platformLinks.map((l) => (l.platform === id ? { ...l, url } : l)),
    }))
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!form.title.trim()) errs.title = 'Title is required'
    if (!form.slug.trim()) errs.slug = 'Slug is required'
    const usd = parseFloat(form.priceUsd)
    if (isNaN(usd) || usd <= 0) errs.priceUsd = 'USD price must be greater than 0'
    const inr = parseFloat(form.priceInr)
    if (isNaN(inr) || inr <= 0) errs.priceInr = 'INR price must be greater than 0'
    if (form.instantDownload && !form.deliverableUrl.trim() && form.deliveryMode !== 'watch')
      errs.deliverable = 'Instant download needs a deliverable file or URL'
    // T-V: watch mode needs the protected full video (whitelisted server-side).
    if (form.instantDownload && form.deliveryMode === 'watch' && !form.fullVideoUrl.trim())
      errs.deliverable = 'Protected watch mode needs the full video link (YouTube Unlisted or ImageKit)'
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      toast({ title: 'Fix the highlighted fields', variant: 'destructive' })
      return
    }
    setSaving(true)
    const usd = Math.round(parseFloat(form.priceUsd) * 100) / 100
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      zone: form.zone,
      category: form.category,
      authorBrand: form.authorBrand.trim(),
      ageOrLevel: form.ageOrLevel.trim() || null,
      priceUsd: usd,
      priceInr: Math.round(parseFloat(form.priceInr)),
      badge: form.badge.trim(),
      description: form.description,
      whatsInside: JSON.stringify(form.whatsInside.map((s) => s.trim()).filter(Boolean)),
      howToUse: form.howToUse,
      license: form.license,
      mediaType: form.mediaType,
      images: JSON.stringify(form.images),
      videoPreviewUrl: form.videoPreviewUrl.trim() || null,
      internationalLink: form.internationalOn && form.internationalLink.trim() ? form.internationalLink.trim() : null,
      indiaLink: form.indiaOn && form.indiaLink.trim() ? form.indiaLink.trim() : null,
      platformLinks: JSON.stringify(
        form.platformLinks
          .filter((l) => l.url.trim())
          .map((l) => ({ platform: l.platform, url: l.url.trim() })),
      ),
      instantDownload: form.instantDownload,
      deliverableUrl: form.instantDownload ? form.deliverableUrl.trim() || null : null,
      deliverableName: form.instantDownload ? form.deliverableName.trim() || null : null,
      // T-V: video-delivery fields (existing products keep 'file').
      deliveryMode: form.deliveryMode,
      fullVideoUrl: form.instantDownload && form.deliveryMode === 'watch' ? form.fullVideoUrl.trim() || null : null,
      watchTtlHours: form.instantDownload && form.deliveryMode === 'watch' && form.watchTtlHours ? parseInt(form.watchTtlHours, 10) || null : null,
      watchMaxConcurrent: form.instantDownload && form.deliveryMode === 'watch' ? Math.min(Math.max(parseInt(form.watchMaxConcurrent, 10) || 2, 1), 10) : 2,
      featured: form.featured,
      sortOrder: parseInt(form.sortOrder, 10) || 0,
      status: form.status,
      tags: JSON.stringify(
        form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
      fileFormats: JSON.stringify(
        form.fileFormats
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
      pageCount: form.pageCount ? parseInt(form.pageCount, 10) || null : null,
      spatialCoords: JSON.stringify(initial.spatial),
    }
    try {
      const res = await adminFetch(product ? `/api/products/${product.id}` : '/api/products', {
        method: product ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      toast({
        title: form.status === 'published' ? 'Published ✓ — view live' : 'Saved as draft',
        description: form.status === 'published' ? `/${form.slug.trim()}` : undefined,
      })
      onDone(true)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const price = priceText(form)
  const checkedPlatforms = new Set(form.platformLinks.map((l) => l.platform))

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" className="h-10" onClick={() => onDone(false)}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Back
          </Button>
          <div>
            <h2 className="font-cinzel text-lg text-[#E5B842]">{product ? 'Edit Product' : 'New Product'}</h2>
            <p className="text-xs text-[#9AA89E]">{product ? `/${product.slug}` : 'Fill the basics — refine anytime'}</p>
          </div>
        </div>
        <Button
          type="submit"
          disabled={saving}
          className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
        >
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          {product ? 'Save Changes' : 'Create Product'}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Left: sections ── */}
        <div className="min-w-0 space-y-5">
          {/* a) Basics */}
          <Section title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="zone">Zone</Label>
                <Select value={form.zone} onValueChange={(v) => changeZone(v as Zone)}>
                  <SelectTrigger id="zone" className="mt-1.5 h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kids">🎨 Kids — Digital Kidosphere</SelectItem>
                    <SelectItem value="creator">🤖 Creator — Sibra Digital Hub</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select value={form.category} onValueChange={(v) => setField('category', v)}>
                  <SelectTrigger id="category" className="mt-1.5 h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cats.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>
                        {c.emoji} {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  onBlur={() => {
                    if (!slugTouched && form.title.trim()) setField('slug', slugify(form.title))
                  }}
                  placeholder="Dino Coloring Adventure"
                  aria-invalid={Boolean(errors.title)}
                  className="mt-1.5 h-10"
                />
                {errText('title') && <p className="mt-1 text-xs text-red-400">{errText('title')}</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="slug">Slug (URL)</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setField('slug', e.target.value)
                  }}
                  placeholder="dino-coloring-adventure"
                  aria-invalid={Boolean(errors.slug)}
                  className="mt-1.5 h-10 font-mono text-sm"
                />
                {errText('slug') && <p className="mt-1 text-xs text-red-400">{errText('slug')}</p>}
              </div>
              <div>
                <Label htmlFor="badge">Badge sticker</Label>
                <Input
                  id="badge"
                  value={form.badge}
                  onChange={(e) => setField('badge', e.target.value)}
                  placeholder="New / Bestseller / Free"
                  className="mt-1.5 h-10"
                />
              </div>
              <div>
                <Label htmlFor="authorBrand">Author / brand</Label>
                <Input
                  id="authorBrand"
                  value={form.authorBrand}
                  onChange={(e) => setField('authorBrand', e.target.value)}
                  className="mt-1.5 h-10"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ageOrLevel">Age or level</Label>
                <Input
                  id="ageOrLevel"
                  value={form.ageOrLevel}
                  onChange={(e) => setField('ageOrLevel', e.target.value)}
                  placeholder={form.zone === 'kids' ? 'Ages 4–8' : 'Beginner → Pro'}
                  className="mt-1.5 h-10"
                />
              </div>
            </div>
          </Section>

          {/* b) Pricing */}
          <Section title="Pricing" hint="Auto-convert fills the INR price at the live USD→INR exchange rate.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="priceUsd">Price (USD)</Label>
                <Input
                  id="priceUsd"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.priceUsd}
                  onChange={(e) => setField('priceUsd', e.target.value)}
                  aria-invalid={Boolean(errors.priceUsd)}
                  className="mt-1.5 h-10"
                />
                {errText('priceUsd') && <p className="mt-1 text-xs text-red-400">{errText('priceUsd')}</p>}
              </div>
              <div>
                <Label htmlFor="priceInr">Price (INR)</Label>
                <div className="mt-1.5 flex items-end gap-2">
                  <Input
                    id="priceInr"
                    type="number"
                    min="0"
                    value={form.priceInr}
                    onChange={(e) => setField('priceInr', e.target.value)}
                    aria-invalid={Boolean(errors.priceInr)}
                    className="h-10"
                  />
                  <Button type="button" variant="outline" className="h-10 shrink-0" onClick={() => void autoConvert()} disabled={converting}>
                    {converting ? 'Converting…' : 'Auto-convert'}
                  </Button>
                </div>
                {errText('priceInr') && <p className="mt-1 text-xs text-red-400">{errText('priceInr')}</p>}
              </div>
            </div>
          </Section>

          {/* c) Descriptions */}
          <Section title="Descriptions">
            <div>
              <Label htmlFor="description">Short description</Label>
              <Textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="One or two lines that sell the product."
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>What’s inside (bullets)</Label>
              <div className="mt-1.5 space-y-2">
                {form.whatsInside.map((bullet, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={bullet}
                      onChange={(e) => updateBullet(i, e.target.value)}
                      placeholder={`Bullet point ${i + 1}`}
                      aria-label={`What’s inside point ${i + 1}`}
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-10 shrink-0 hover:border-red-500/50 hover:text-red-300"
                      onClick={() => removeBullet(i)}
                      aria-label={`Remove bullet ${i + 1}`}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" className="h-10" onClick={addBullet}>
                  <Plus className="size-4" aria-hidden="true" /> Add bullet
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="howToUse">How to use</Label>
              <Textarea
                id="howToUse"
                rows={2}
                value={form.howToUse}
                onChange={(e) => setField('howToUse', e.target.value)}
                placeholder="Download → print at 100% scale → play."
                className="mt-1.5"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="license">License</Label>
                <Select value={form.license} onValueChange={(v) => setField('license', v as License)}>
                  <SelectTrigger id="license" className="mt-1.5 h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">Personal use</SelectItem>
                    <SelectItem value="commercial">Commercial use</SelectItem>
                    <SelectItem value="extended">Extended license</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pageCount">Pages (optional)</Label>
                <Input
                  id="pageCount"
                  type="number"
                  min="0"
                  value={form.pageCount}
                  onChange={(e) => setField('pageCount', e.target.value)}
                  placeholder="e.g. 24"
                  className="mt-1.5 h-10"
                />
              </div>
              <div>
                <Label htmlFor="fileFormats">File formats</Label>
                <Input
                  id="fileFormats"
                  value={form.fileFormats}
                  onChange={(e) => setField('fileFormats', e.target.value)}
                  placeholder="PDF, PNG"
                  className="mt-1.5 h-10"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={form.tags}
                onChange={(e) => setField('tags', e.target.value)}
                placeholder={form.zone === 'kids' ? 'coloring, dinosaurs, printable' : 'canva, prompts, automation'}
                className="mt-1.5 h-10"
              />
            </div>
          </Section>

          {/* d) Media */}
          <Section title="Media">
            <div className="flex items-center gap-3">
              <span className={`text-sm ${form.mediaType === 'images' ? 'font-semibold text-[#E5B842]' : 'text-[#9AA89E]'}`}>
                🖼 Images
              </span>
              <Switch
                checked={form.mediaType === 'video'}
                onCheckedChange={(v) => setField('mediaType', v ? 'video' : 'images')}
                aria-label="Toggle between image and video media"
              />
              <span className={`text-sm ${form.mediaType === 'video' ? 'font-semibold text-[#E5B842]' : 'text-[#9AA89E]'}`}>
                🎬 Video
              </span>
            </div>

            {form.mediaType === 'images' ? (
              <div className="space-y-2">
                {form.images.map((url, i) => (
                  <div key={`${i}-${url}`} className="flex items-center gap-2 rounded-xl border border-white/10 p-2">
                    <img
                      src={url}
                      alt={`Product image ${i + 1}`}
                      className="size-14 shrink-0 rounded-lg border border-white/10 object-cover"
                    />
                    <p className="min-w-0 flex-1 truncate font-mono text-xs text-[#9AA89E]">{url}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      disabled={i === 0}
                      onClick={() => moveImage(i, -1)}
                      aria-label={`Move image ${i + 1} up`}
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      disabled={i === form.images.length - 1}
                      onClick={() => moveImage(i, 1)}
                      aria-label={`Move image ${i + 1} down`}
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 hover:border-red-500/50 hover:text-red-300"
                      onClick={() => removeImage(i)}
                      aria-label={`Remove image ${i + 1}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                {imgUploading.map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-2 rounded-xl border border-dashed border-white/15 p-2 text-xs text-[#9AA89E]"
                  >
                    <Loader2 className="size-4 animate-spin text-[#E5B842]" aria-hidden="true" /> Uploading “{name}”…
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="Paste image URL (https://…)"
                    aria-label="Image URL"
                    className="h-10"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addImageUrl()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 shrink-0"
                    disabled={!imageUrl.trim() || form.images.length >= MAX_IMAGES}
                    onClick={addImageUrl}
                  >
                    <Plus className="size-4" aria-hidden="true" /> Add
                  </Button>
                </div>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={imgUploading.length > 0 || form.images.length >= MAX_IMAGES}
                    onClick={() => imgInputRef.current?.click()}
                  >
                    <Upload className="size-4" aria-hidden="true" />
                    Upload images ({form.images.length}/{MAX_IMAGES})
                  </Button>
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                    aria-label="Upload images"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="videoUrl">Video preview URL</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="videoUrl"
                      value={form.videoPreviewUrl}
                      onChange={(e) => setField('videoPreviewUrl', e.target.value)}
                      placeholder="https://youtube.com/watch?v=… , youtu.be/… or direct MP4 link"
                      className="h-10 font-mono text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && form.videoPreviewUrl.trim()) {
                          e.preventDefault()
                          toast({ title: 'Video link added' })
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0"
                      disabled={!form.videoPreviewUrl.trim()}
                      onClick={() => toast({ title: 'Video link added' })}
                    >
                      <Plus className="size-4" aria-hidden="true" /> Add
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-[#9AA89E]">
                    YouTube links supported — watch / shorts / youtu.be links embed automatically. Direct MP4/WebM/MOV and
                    GitHub-hosted file links play in the native player.
                  </p>
                  {/* T-V Feature B — required admin note */}
                  <p className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300">
                    ⚠️ This video is public. Use a short sample, not your full paid video.
                  </p>
                </div>
                {(() => {
                  const embed = toYouTubeEmbedUrl(form.videoPreviewUrl)
                  if (embed)
                    return (
                      <iframe
                        src={embed}
                        title="Video preview"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="aspect-video w-full rounded-xl border border-white/10"
                      />
                    )
                  if (form.videoPreviewUrl.trim())
                    return <video src={form.videoPreviewUrl} controls className="w-full rounded-xl border border-white/10" />
                  return null
                })()}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={videoUploading}
                    onClick={() => videoInputRef.current?.click()}
                  >
                    {videoUploading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="size-4" aria-hidden="true" />
                    )}
                    Upload video
                  </Button>
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/webm"
                    className="hidden"
                    onChange={handleVideoUpload}
                    aria-label="Upload video"
                  />
                  <p className="mt-1.5 text-xs text-[#9AA89E]">MP4 or WebM · up to ~100 MB</p>
                </div>
              </div>
            )}
          </Section>

          {/* e) Checkout buttons */}
          <Section
            title="Checkout Buttons"
            hint="Only the options switched ON here appear on the live site — you decide exactly what buyers see."
          >
            <div className="rounded-xl border border-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="intl" className="text-sm">
                  🌍 Global Purchase (USD) — Gumroad/Payhip link
                </Label>
                <Switch id="intl" checked={form.internationalOn} onCheckedChange={(v) => setField('internationalOn', v)} />
              </div>
              {form.internationalOn && (
                <Input
                  value={form.internationalLink}
                  onChange={(e) => setField('internationalLink', e.target.value)}
                  placeholder="https://gum.co/your-product"
                  aria-label="Global purchase link"
                  className="mt-3 h-10 font-mono text-xs"
                />
              )}
            </div>

            <div className="rounded-xl border border-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="india" className="text-sm">
                  🇮🇳 Indian Checkout (UPI) — Razorpay link
                </Label>
                <Switch id="india" checked={form.indiaOn} onCheckedChange={(v) => setField('indiaOn', v)} />
              </div>
              {form.indiaOn && (
                <Input
                  value={form.indiaLink}
                  onChange={(e) => setField('indiaLink', e.target.value)}
                  placeholder="https://rzp.io/l/your-product"
                  aria-label="Indian checkout link"
                  className="mt-3 h-10 font-mono text-xs"
                />
              )}
            </div>

            <div>
              <Label>Marketplace buttons — tick only what this product sells on</Label>
              <div className="mt-2 grid gap-2 xl:grid-cols-2">
                {PLATFORMS.map((meta) => {
                  const checked = checkedPlatforms.has(meta.id)
                  const link = form.platformLinks.find((l) => l.platform === meta.id)
                  return (
                    <div key={meta.id} className="rounded-xl border border-white/10 p-3">
                      <label className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => togglePlatform(meta.id, v === true)}
                          aria-label={`Enable ${meta.short} button`}
                        />
                        <span className="text-lg" aria-hidden="true">
                          {meta.emoji}
                        </span>
                        <span className="min-w-0 text-sm font-medium">{meta.short}</span>
                        <span className="ml-auto hidden max-w-full text-right text-[11px] leading-snug text-[#9AA89E] sm:block">
                          {meta.subtext}
                        </span>
                      </label>
                      {checked && link && (
                        <Input
                          value={link.url}
                          onChange={(e) => setPlatformUrl(meta.id, e.target.value)}
                          placeholder={`https://…/${meta.id}-link`}
                          aria-label={`${meta.short} URL`}
                          className="mt-2 h-9 font-mono text-xs"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="instant" className="text-sm font-semibold">
                  ⚡ Instant Email Delivery (UPI auto-fulfilment)
                </Label>
                <Switch
                  id="instant"
                  checked={form.instantDownload}
                  onCheckedChange={(v) => setField('instantDownload', v)}
                />
              </div>
              {form.instantDownload && (
                <div className="mt-4 space-y-3">
                  {/* T-V — delivery mode: file · external link · protected watch page */}
                  <div className="rounded-lg border border-white/10 bg-[#07090B]/40 p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#9AA89E]">Delivery mode</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {([
                        { id: 'file', label: 'File download', hint: 'Upload a PDF/ZIP' },
                        { id: 'external', label: 'External link', hint: 'Link in email' },
                        { id: 'watch', label: 'Protected watch page', hint: 'Video on our site' },
                      ] as const).map((m) => (
                        <label
                          key={m.id}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors ${
                            form.deliveryMode === m.id
                              ? 'border-emerald-400/60 bg-emerald-500/10'
                              : 'border-white/10 hover:border-white/25'
                          }`}
                        >
                          <input
                            type="radio"
                            name="deliveryMode"
                            value={m.id}
                            checked={form.deliveryMode === m.id}
                            onChange={() => setField('deliveryMode', m.id)}
                            className="mt-0.5 accent-emerald-500"
                          />
                          <span>
                            <span className="block text-xs font-bold text-[#F5F8F6]">{m.label}</span>
                            <span className="block text-[10px] text-[#9AA89E]">{m.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Watch-mode fields */}
                    {form.deliveryMode === 'watch' && (
                      <div className="mt-3 space-y-3 rounded-lg border border-cyan-400/25 bg-cyan-500/5 p-3">
                        <div>
                          <Label htmlFor="fullVideoUrl">Full video link (YouTube Unlisted or ImageKit)</Label>
                          <Input
                            id="fullVideoUrl"
                            value={form.fullVideoUrl}
                            onChange={(e) => setField('fullVideoUrl', e.target.value)}
                            placeholder="https://youtube.com/watch?v=… (Unlisted)"
                            className="mt-1.5 h-10 font-mono text-xs"
                          />
                          <p className="mt-1 text-[11px] text-cyan-300/90 font-semibold">
                            Use an Unlisted video. Private videos will not play for buyers.
                          </p>
                          <p className="mt-1 text-[11px] text-[#9AA89E]">
                            The link stays private on the server — buyers get an on-site watch page, never the raw
                            link. Only YouTube and ImageKit links are accepted.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="watchTtl">Access hours (blank = site default)</Label>
                            <Input
                              id="watchTtl"
                              type="number"
                              min={1}
                              max={720}
                              value={form.watchTtlHours}
                              onChange={(e) => setField('watchTtlHours', e.target.value)}
                              placeholder="48"
                              className="mt-1.5 h-10"
                            />
                          </div>
                          <div>
                            <Label htmlFor="watchMax">Devices at once</Label>
                            <Input
                              id="watchMax"
                              type="number"
                              min={1}
                              max={10}
                              value={form.watchMaxConcurrent}
                              onChange={(e) => setField('watchMaxConcurrent', e.target.value)}
                              className="mt-1.5 h-10"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {form.deliveryMode !== 'watch' && (
                    <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10"
                      disabled={deliverableUploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {deliverableUploading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="size-4" aria-hidden="true" />
                      )}
                      Upload deliverable
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.zip"
                      className="hidden"
                      onChange={handleDeliverableUpload}
                      aria-label="Upload deliverable file"
                    />
                    <span className="text-xs text-[#9AA89E]">PDF or ZIP</span>
                  </div>
                  {form.deliverableUrl && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-[#07090B]/60 p-2 text-xs">
                      <Zap className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                      {form.deliverableUrl.startsWith('r2:') ? (
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-emerald-300">
                            {form.deliverableName || 'Private deliverable'}
                          </p>
                          <p className="text-[10px] text-emerald-400/80">
                            Stored securely in Cloudflare R2
                          </p>
                        </div>
                      ) : (
                        <a
                          href={form.deliverableUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate font-mono text-emerald-300 hover:underline"
                        >
                          {form.deliverableName || form.deliverableUrl}
                        </a>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setField('deliverableUrl', '')
                          setField('deliverableName', '')
                        }}
                        aria-label="Remove deliverable"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="deliverableUrl">…or paste file URL</Label>
                    <Input
                      id="deliverableUrl"
                      value={form.deliverableUrl}
                      onChange={(e) => setField('deliverableUrl', e.target.value)}
                      placeholder="https://…/prompts-pack.zip"
                      className="mt-1.5 h-10 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="deliverableName">File name buyers see</Label>
                    <Input
                      id="deliverableName"
                      value={form.deliverableName}
                      onChange={(e) => setField('deliverableName', e.target.value)}
                      placeholder="AI-Prompts-Pack.zip"
                      className="mt-1.5 h-10"
                    />
                  </div>
                  {errText('deliverable') && <p className="text-xs text-red-400">{errText('deliverable')}</p>}
                  <p className="text-[11px] leading-relaxed text-[#9AA89E]">
                    Buyer pays via UPI → file link is emailed automatically in seconds. Use for prompts, scripts &amp; digital packs.
                  </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* f) Meta */}
          <Section title="Visibility & Order">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="status">Status</Label>
                <Select value={form.status} onValueChange={(v) => setField('status', v as ProductStatus)}>
                  <SelectTrigger id="status" className="mt-1.5 h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft — hidden</SelectItem>
                    <SelectItem value="published">Published — live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sortOrder">Sort order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setField('sortOrder', e.target.value)}
                  className="mt-1.5 h-10"
                />
              </div>
              <div>
                <Label htmlFor="featured">Featured</Label>
                <div className="mt-1.5 flex h-10 items-center gap-2">
                  <Switch id="featured" checked={form.featured} onCheckedChange={(v) => setField('featured', v)} />
                  <Star
                    className={`size-4 ${form.featured ? 'fill-[#E5B842] text-[#E5B842]' : 'text-[#9AA89E]'}`}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* ── Right: sticky live preview (stacks below the form on small screens) ── */}
        <aside className="block">
          <div className="space-y-3 lg:sticky lg:top-6">
            <p className="font-cinzel text-xs uppercase tracking-widest text-[#E5B842]">Live Preview</p>
            {form.zone === 'kids' ? <KidsPreview form={form} /> : <CreatorPreview form={form} />}
            <p className="rounded-xl border border-white/10 p-3 text-[11px] leading-relaxed text-[#9AA89E]">
              Only the checkout buttons switched ON here will appear on the live site. Unticked platforms and empty
              links are hidden from buyers — the button row above is exactly what they get. (₹{price.inr} · {price.usd})
            </p>
          </div>
        </aside>
      </div>
    </form>
  )
}
