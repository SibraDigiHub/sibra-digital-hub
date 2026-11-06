// ═══════════════════════════════════════════════════════════
// T6 §7.1 — Storage adapters (ImageKit) + upload safety rails.
//
// ImageKit is the only storage backend (§0.4 — no Supabase):
//   • PUBLIC media (images/video)  → direct browser uploads with
//     short-lived signed params minted by the ADMIN-ONLY route
//     GET /api/imagekit/auth (the private key never leaves here).
//   • PAID deliverables            → ImageKit PRIVATE files; the
//     product stores an `ik:<path>` reference in deliverableUrl
//     (the path is NEVER a public URL), and 10-minute signed
//     download URLs are minted server-side at claim time only
//     (see /api/download/[token]).
//
// Allow-lists + caps (documented, enforced wherever uploads or
// deliverable references are accepted):
//   • public media images : jpg/jpeg/png/webp/gif  (SVG refused — XSS)
//   • public media video  : mp4/webm
//   • deliverables        : pdf/zip/apk/epub/txt
//   • size caps           : media 25 MB · deliverables 100 MB
// ═══════════════════════════════════════════════════════════
import crypto from 'crypto'

// ── Documented size caps (§7.1) ─────────────────────────────
/** Public media (images + video) upload cap: 25 MB. */
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024
/** Paid deliverable upload cap: 100 MB. */
export const DELIVERABLE_MAX_BYTES = 100 * 1024 * 1024

/** Signed download-URL lifetime for ImageKit private files: 10 minutes. */
export const PRIVATE_URL_TTL_SECONDS = 600

// ── Upload kinds → folders (server-side scoping) ────────────
export const UPLOAD_KINDS = ['media', 'video', 'deliverable'] as const
export type UploadKind = (typeof UPLOAD_KINDS)[number]

const EXT_ALLOW: Record<UploadKind, readonly string[]> = {
  media: ['jpg', 'jpeg', 'png', 'webp', 'gif'], // SVG deliberately refused (§7.1)
  video: ['mp4', 'webm'],
  deliverable: ['pdf', 'zip', 'apk', 'epub', 'txt'],
}

const MIME_ALLOW: Record<UploadKind, readonly string[]> = {
  media: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm'],
  deliverable: [
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.android.package-archive',
    'application/epub+zip',
    'text/plain',
  ],
}

const MAX_BYTES: Record<UploadKind, number> = {
  media: MEDIA_MAX_BYTES,
  video: MEDIA_MAX_BYTES,
  deliverable: DELIVERABLE_MAX_BYTES,
}

/** ImageKit folder each kind is scoped to (signed params carry it). */
const FOLDER: Record<UploadKind, string> = {
  media: 'public-media',
  video: 'public-video',
  deliverable: 'private-deliverables',
}

export function folderForKind(kind: UploadKind): string {
  return FOLDER[kind]
}

export function maxBytesForKind(kind: UploadKind): number {
  return MAX_BYTES[kind]
}

// ── File-name sanitisation (no path traversal) ──────────────
/**
 * Reduce a client-supplied file name to a safe basename:
 * strip every directory component (kills ../ and ..\ traversal),
 * control characters, Windows-unsafe characters and leading dots.
 * Returns null when nothing safely usable remains.
 */
export function sanitizeFileName(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let name = raw.split(/[\\/]/).pop() ?? '' // basename — ../ ..\ neutralised
  name = name.replace(/[\u0000-\u001f\u007f]/g, '') // control chars
  name = name.replace(/^\.+/, '') // no leading dots (hidden files / dot-tricks)
  name = name.replace(/[<>:"|?*]/g, '') // Windows-unsafe set
  name = name.replace(/\s+/g, ' ').trim()
  if (!name || name === '.' || name === '..') return null
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : '' // keep the extension intact
  const stem = dot > 0 ? name.slice(0, dot) : name
  // Hard cap: 180-char stem + extension (ImageKit-safe, filesystem-safe).
  return `${stem.slice(0, 180)}${ext}`
}

export type UploadValidation =
  | { ok: true; fileName: string; ext: string; folder: string }
  | { ok: false; reason: string }

/**
 * Validate an upload against the per-kind allow-lists and caps.
 * `fileName` is required (extension allow-list); mimeType and
 * sizeBytes are validated when the client supplies them.
 */
export function validateUpload(
  kind: UploadKind,
  input: { fileName?: string | null; mimeType?: string | null; sizeBytes?: number | null },
): UploadValidation {
  const sanitized = sanitizeFileName(input.fileName ?? '')
  if (!sanitized) return { ok: false, reason: 'Invalid or unsafe file name' }

  const dot = sanitized.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'File must have an extension' }
  const ext = sanitized.slice(dot + 1).toLowerCase()
  if (!EXT_ALLOW[kind].includes(ext)) {
    return { ok: false, reason: `.${ext} files are not allowed for ${kind} uploads (allowed: ${EXT_ALLOW[kind].join(', ')})` }
  }

  if (input.mimeType) {
    const mime = input.mimeType.toLowerCase().split(';')[0].trim()
    if (!MIME_ALLOW[kind].includes(mime)) {
      return { ok: false, reason: `MIME type ${mime} is not allowed for ${kind} uploads` }
    }
  }

  if (typeof input.sizeBytes === 'number' && input.sizeBytes > MAX_BYTES[kind]) {
    const mb = Math.round(MAX_BYTES[kind] / (1024 * 1024))
    return { ok: false, reason: `File exceeds the ${mb} MB limit for ${kind} uploads` }
  }

  return { ok: true, fileName: sanitized, ext, folder: FOLDER[kind] }
}

// ── ImageKit configuration + signing ────────────────────────
function imagekitEnv(): { privateKey: string; publicKey: string; endpoint: string } | null {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY
  const publicKey = process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY
  const endpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
  if (!privateKey || !publicKey || !endpoint) return null
  return { privateKey, publicKey, endpoint }
}

export function imagekitConfigured(): boolean {
  return imagekitEnv() !== null
}

/**
 * Short-lived signed upload parameters for direct browser uploads
 * (ImageKit authentication algorithm: signature = HMAC-SHA1(
 * privateKey, token + expire) — unchanged from the pre-T6 route).
 */
export function imagekitAuthParams(): { token: string; expire: number; signature: string; publicKey: string; endpoint: string } {
  const cfg = imagekitEnv()
  if (!cfg) throw new Error('ImageKit is not configured')
  const token = crypto.randomBytes(16).toString('hex')
  const expire = Math.floor(Date.now() / 1000) + 60 * 30
  const signature = crypto.createHmac('sha1', cfg.privateKey).update(token + expire).digest('hex')
  return { token, expire, signature, publicKey: cfg.publicKey, endpoint: cfg.endpoint }
}

// ── Private-file references (`ik:` scheme) ──────────────────
/**
 * Deliverables stored as ImageKit PRIVATE files use the `ik:` scheme
 * in Product.deliverableUrl: `ik:<path>` where <path> is the ImageKit
 * file path relative to the URL endpoint (the `filePath` the upload
 * API returns). The raw path never leaves the server — public DTOs
 * strip deliverableUrl entirely and downloads mint signed URLs.
 */
export const IMAGEKIT_REF_PREFIX = 'ik:'

export function isImagekitRef(url: string): boolean {
  return typeof url === 'string' && url.startsWith(IMAGEKIT_REF_PREFIX)
}

/**
 * Extract + validate the ImageKit path from an `ik:` reference.
 * Rejects empty refs, query strings/fragments, traversal segments
 * and control characters. Returns the path WITH its leading slash
 * (ImageKit's canonical form) or null when unsafe/invalid.
 */
export function parseImagekitRef(ref: string): string | null {
  if (!isImagekitRef(ref)) return null
  let path = ref.slice(IMAGEKIT_REF_PREFIX.length).trim()
  if (!path) return null
  if (path.includes('?') || path.includes('#')) return null
  if (/[\u0000-\u001f\u007f]/.test(path)) return null
  path = `/${path.replace(/^\/+/, '')}`
  if (path.split('/').some((seg) => seg === '..')) return null
  if (path.length > 512) return null
  return path
}

/**
 * Mint a signed URL for an ImageKit PRIVATE file (§7.1):
 *   GET <endpoint>/<path>?ik-sig=HMAC-SHA256(privateKey, path+expire)&ik-exp=<expire>
 * Default validity: 10 minutes (PRIVATE_URL_TTL_SECONDS). The HMAC
 * input is the canonical path WITH its leading slash + the unix-second
 * expire timestamp. Returns null when ImageKit is unconfigured or the
 * reference is unsafe — callers answer the existing 404 shape.
 */
export function imagekitSignedUrlFromRef(
  ref: string,
  opts: { ttlSeconds?: number; now?: number } = {},
): string | null {
  const cfg = imagekitEnv()
  if (!cfg) return null
  const path = parseImagekitRef(ref)
  if (!path) return null
  const ttl = opts.ttlSeconds ?? PRIVATE_URL_TTL_SECONDS
  const expire = Math.floor((opts.now ?? Date.now()) / 1000) + ttl
  const signature = crypto.createHmac('sha256', cfg.privateKey).update(path + expire).digest('hex')
  const base = cfg.endpoint.replace(/\/+$/, '')
  return `${base}${path}?ik-sig=${signature}&ik-exp=${expire}`
}

// ── Local-disk guard (§7.1) ─────────────────────────────────
/**
 * Local-disk storage is a DEVELOPMENT-ONLY fallback. The backend has
 * no local-disk upload route (admin media/deliverables go through
 * ImageKit or external https links). If one is ever introduced it
 * MUST consult this guard and be refused in production — never wire
 * a disk-writable route without it.
 */
export function localDiskStorageAllowed(): boolean {
  return process.env.NODE_ENV !== 'production'
}
