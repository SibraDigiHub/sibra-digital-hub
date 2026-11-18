// ═══════════════════════════════════════════════════════════
// Storage-cleanup §1 — managed-reference classification (pure).
//
// A "managed ref" is a stored value that points at a file WE own:
//   • Cloudflare R2 deliverable   → `r2:private-deliverables/<key>`
//   • ImageKit private deliverable → `ik:<path>`
//   • ImageKit-hosted public media → https URL on the ImageKit
//     endpoint under our managed folders.
// Everything else — YouTube links, site-relative seed paths
// (`/images/...` served by the frontend), external https files,
// marketplace links — is NOT ours and is never touched.
// ═══════════════════════════════════════════════════════════
import { isR2Ref, parseR2Ref } from '@/lib/r2'
import { isImagekitRef, parseImagekitRef } from '@/lib/storage'

/** Folders the admin forms upload into (backend scopes + legacy form folders). */
export const MANAGED_IMAGEKIT_FOLDERS = [
  'public-media',
  'public-video',
  'private-deliverables',
  // Legacy folders the pre-T6 admin form hardcoded (same account, ours).
  'images',
  'video',
] as const

export interface ManagedRef {
  /** Exact string as stored in the DB (map key everywhere). */
  ref: string
  provider: 'ik' | 'r2'
  /** ImageKit path relative to the endpoint (with leading slash) or null. */
  path: string | null
  /** ImageKit fileId when known (upload responses / mediaRefs). */
  fileId?: string
}

function imagekitEndpointUrl(): URL | null {
  const endpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
  if (!endpoint) return null
  try {
    return new URL(endpoint)
  } catch {
    return null
  }
}

/** The path of an ImageKit URL relative to the endpoint (with leading slash). */
function imagekitRelativePath(url: URL, endpoint: URL | null): string | null {
  let urlPath = decodeURIComponent(url.pathname)
  if (endpoint && endpoint.pathname !== '/' && endpoint.pathname !== '') {
    const prefix = endpoint.pathname.replace(/\/+$/, '')
    if (!urlPath.startsWith(prefix)) return null
    urlPath = urlPath.slice(prefix.length) || '/'
  }
  return urlPath.startsWith('/') ? urlPath : `/${urlPath}`
}

function folderManaged(path: string): boolean {
  if (MANAGED_IMAGEKIT_FOLDERS.some((f) => path === `/${f}` || path.startsWith(`/${f}/`))) return true
  // Endpoint-relative fallback: endpoints that carry an account subpath
  // (https://ik.imagekit.io/<account>/…) embed the managed folder deeper
  // in the path, and a stored URL may also predate an endpoint change.
  // Safe because the HOST is already pinned to OUR ImageKit endpoint —
  // a managed-folder segment on our own host is ours by construction.
  return path.split('/').some((seg) => (MANAGED_IMAGEKIT_FOLDERS as readonly string[]).includes(seg))
}

/**
 * Classify a stored value. Returns null for anything we do not own —
 * the conservative direction: unmanaged values are never deleted.
 */
export function classifyManagedRef(value: unknown): ManagedRef | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null

  if (isR2Ref(v)) {
    const key = parseR2Ref(v)
    return key ? { ref: v, provider: 'r2', path: key } : null
  }

  if (isImagekitRef(v)) {
    const path = parseImagekitRef(v)
    return path ? { ref: v, provider: 'ik', path } : null
  }

  let url: URL
  try {
    url = new URL(v)
  } catch {
    return null // site-relative paths (/images/…), YouTube IDs, junk — not ours
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const endpoint = imagekitEndpointUrl()
  const endpointHost = endpoint?.hostname ?? 'ik.imagekit.io'
  if (url.hostname !== endpointHost) return null
  const rel = imagekitRelativePath(url, endpoint)
  if (!rel || !folderManaged(rel)) return null
  return { ref: v, provider: 'ik', path: rel }
}

type MediaRefsLike = { images?: unknown; videoPreviewUrl?: unknown; fullVideoUrl?: unknown; deliverableUrl?: unknown }

function parseImagesField(images: unknown): string[] {
  if (typeof images !== 'string' || !images) return []
  try {
    const arr = JSON.parse(images)
    return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string') : []
  } catch {
    return []
  }
}

/** Every managed ref a product row currently references (dedup, order-stable). */
export function collectRowManagedRefs(row: MediaRefsLike): ManagedRef[] {
  const candidates = [
    ...parseImagesField(row.images),
    row.videoPreviewUrl,
    row.fullVideoUrl,
    row.deliverableUrl,
  ]
  const seen = new Set<string>()
  const out: ManagedRef[] = []
  for (const c of candidates) {
    const m = classifyManagedRef(c)
    if (m && !seen.has(m.ref)) {
      seen.add(m.ref)
      out.push(m)
    }
  }
  return out
}

/** Managed refs present in `before` but gone from `after` — delete candidates. */
export function removedManagedRefs(before: MediaRefsLike, after: MediaRefsLike): ManagedRef[] {
  const keep = new Set(collectRowManagedRefs(after).map((r) => r.ref))
  return collectRowManagedRefs(before).filter((r) => !keep.has(r.ref))
}

// ── mediaRefs JSON map (fileId registry) ────────────────────
export interface MediaRefEntry {
  p: 'ik' | 'r2'
  id?: string
  path?: string
}

export function parseMediaRefs(json: unknown): Record<string, MediaRefEntry> {
  if (typeof json !== 'string' || !json) return {}
  try {
    const obj = JSON.parse(json)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, MediaRefEntry> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const e = v as Record<string, unknown>
      if (e.p !== 'ik' && e.p !== 'r2') continue
      out[k] = { p: e.p, ...(typeof e.id === 'string' ? { id: e.id } : {}), ...(typeof e.path === 'string' ? { path: e.path } : {}) }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Merge the mediaRefs registry for a save: previous entries (the fileId
 * cache — kept even for removed refs so deletion can find the id) +
 * admin-uploaded fileIds + derived entries for every managed ref present
 * in the final fields. Pure; called BEFORE the update write.
 */
export function computeMediaRefs(
  prevJson: unknown,
  uploadedFileIds: Record<string, string> | null | undefined,
  row: MediaRefsLike,
): string {
  const map = parseMediaRefs(prevJson)

  if (uploadedFileIds && typeof uploadedFileIds === 'object') {
    for (const [url, fileId] of Object.entries(uploadedFileIds)) {
      const m = classifyManagedRef(url)
      if (m && m.provider === 'ik' && typeof fileId === 'string' && fileId && fileId.length <= 128) {
        map[m.ref] = { p: 'ik', id: fileId, ...(m.path ? { path: m.path } : {}) }
      }
    }
  }

  for (const m of collectRowManagedRefs(row)) {
    if (!map[m.ref]) map[m.ref] = { p: m.provider, ...(m.fileId ? { id: m.fileId } : {}), ...(m.path ? { path: m.path } : {}) }
  }

  return JSON.stringify(map)
}
