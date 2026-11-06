// ═══════════════════════════════════════════════════════════
// T-V (Features B/C): server-side video source whitelist.
//
// The ONLY video sources this store accepts:
//   • YouTube  — youtube.com / www.youtube.com / m.youtube.com /
//                youtube-nocookie.com / youtu.be
//   • ImageKit — files hosted on our own ImageKit account
//                (https://ik.imagekit.io/... or the account's
//                own *.imagekit.io endpoint)
//   • Direct file — any https URL ending in .mp4 / .webm / .mov /
//                .m4v (the admin form promises these play in the
//                native player; GitHub-hosted raw files included)
// Everything else is REJECTED before it is ever stored, so a
// fake/dangerous/trackery link can never reach a page.
//
// The admin pastes a link ONCE; the server keeps the raw value
// private (DB-only) and pages only ever receive:
//   • a youtube-nocookie embed URL built here from the video id
//   • a short-lived ImageKit URL minted here at play time
//   • the direct file URL itself (.mp4/.webm — public by nature)
// A raw admin link is never pasted into any page (brief §B.1).
// ═══════════════════════════════════════════════════════════

export type VideoSource =
  | { provider: 'youtube'; videoId: string }
  | { provider: 'imagekit'; ref: string } // https URL on our ImageKit endpoint
  | { provider: 'file'; ref: string } // direct https .mp4/.webm/.mov/.m4v link (public by nature)

const YT_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'youtu.be'])

/** 11-char YouTube video id (letters, digits, `_`, `-`). */
function validYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id)
}

/**
 * Invisible Unicode that clipboard copies (chat apps, docs) often carry —
 * soft hyphen, zero-width spaces/joiners/marks, BOM. They render as nothing,
 * are never intended, and would fail the host/id checks while the pasted
 * link looks perfectly correct to the admin. Stripped before parsing; for
 * clean input this is exactly `trim()`.
 */
const INVISIBLE_CHARS_RE = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g
// Remaining clipboard glue: Unicode format characters + whitespace inside
// the link (NBSP, word joiner, directional marks, …). A valid URL never
// contains them raw, so stripping is lossless for correct links.
const URL_GLUE_RE = /[\p{Cf}\s]/gu
// Quote/bracket pairs a link gets wrapped in when it is copied from a
// chat message, a document or a webpage ("…", ‘…’, “…”, <…>, (…), […]).
// Stripped only when they wrap the WHOLE link, never inside it.
const WRAP_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'], ["'", "'"], ['`', '`'], ['<', '>'], ['(', ')'], ['[', ']'], ['{', '}'],
  ['“', '”'], ['‘', '’'], ['«', '»'], ['‹', '›'],
]
// Sentence punctuation that ends a link copied from prose ("watch?v=….",
// "see (watch?v=…)" — closing brackets included; a valid URL never ends
// with one of these characters).
const TRAILING_PUNCT_RE = /[.,;:!?…。、।)\]}>]+$|^[.,;:!?…。、।]+/gu
// A stray opening bracket/quote left after asymmetric copies ("(url")
const LEADING_WRAP_RE = /^[(\[{'"`<“”‘’«»‹›]+/u

/** True when the link is wrapped by a matching open/close pair. */
function wrapPairOf(out: string): [string, string] | null {
  if (out.length < 2) return null
  const first = out[0]
  const last = out[out.length - 1]
  for (const [open, close] of WRAP_PAIRS) {
    if (first === open && last === close) return [first, last]
  }
  return null
}

/**
 * Trim + strip clipboard artifacts from an admin-pasted link: invisible
 * Unicode, format/space glue, wrapping quotes/brackets and trailing
 * sentence punctuation. For a cleanly-copied link this is byte-identical
 * to `trim()` — the provider whitelist in parseVideoSource is unchanged.
 */
export function cleanPastedVideoUrl(raw: string): string {
  let out = raw.replace(INVISIBLE_CHARS_RE, '').replace(URL_GLUE_RE, '')
  for (let changed = true; changed; ) {
    const pair = wrapPairOf(out)
    if (pair) {
      out = out.slice(1, -1)
    } else {
      const before = out
      out = out.replace(LEADING_WRAP_RE, '').replace(TRAILING_PUNCT_RE, '')
      changed = out !== before
    }
  }
  return out.trim()
}

/**
 * Parse an admin-pasted video link into a safe VideoSource, or null
 * when the URL is not from an allowed provider. Accepts the common
 * YouTube shapes (watch?v=, youtu.be, /embed/, /shorts/, /live/),
 * our ImageKit endpoint, and direct https links to a video file
 * (.mp4/.webm/.mov/.m4v — query strings allowed).
 */
export function parseVideoSource(rawUrl: string | null | undefined): VideoSource | null {
  if (!rawUrl) return null
  const trimmed = cleanPastedVideoUrl(rawUrl)
  if (!/^https:\/\//i.test(trimmed)) return null // admin links must be https

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()

  // ── YouTube ──
  if (YT_HOSTS.has(host)) {
    let id = ''
    if (host === 'youtu.be') {
      id = parsed.pathname.slice(1).split('/')[0]
    } else if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v') ?? ''
    } else {
      const m = parsed.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/)
      if (m) id = m[2]
    }
    return validYouTubeId(id) ? { provider: 'youtube', videoId: id } : null
  }

  // ── ImageKit (our own account only) ──
  if (host === 'ik.imagekit.io' || host.endsWith('.imagekit.io')) {
    const path = `${parsed.pathname}${parsed.search}`
    // must point at a file path, not the bare endpoint
    if (path.length > 1) return { provider: 'imagekit', ref: trimmed }
    return null
  }

  // ── Direct video file link (.mp4 / .webm / .mov / .m4v) ──
  // The admin form's own copy promises these play in the native player
  // ("Direct MP4/WebM/MOV and GitHub-hosted file links"). A direct file
  // URL is public by nature — the same exposure an ImageKit public file
  // has. .mov/.m4v are the remaining extensions the store's own video
  // packs ship in (e.g. "FORMAT: MP4/MOV/PNG"), and both play in the
  // native <video> element.
  {
    const path = parsed.pathname.toLowerCase()
    if (path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov') || path.endsWith('.m4v')) {
      return { provider: 'file', ref: trimmed }
    }
  }

  return null
}

/** Is this stored value an ImageKit `ik:<path>` private-file reference? (existing T6 helper shape) */
export function isIkRef(value: string): boolean {
  return value.startsWith('ik:')
}

/**
 * Privacy-friendly YouTube embed URL (youtube-nocookie.com) with:
 *  • YouTube's own fullscreen button DISABLED (`fs=0`) — the site
 *    ships its own fullscreen control (brief §B.3/§B.4)
 *  • related-video suggestions off (`rel=0`)
 *  • jsapi off so the player cannot be scripted from the parent page
 */
export function youTubePrivacyEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({ rel: '0', fs: '0', disablekb: '0', playsinline: '1', iv_load_policy: '3' })
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`
}

/** Channel URL whitelists (Feature A) — per social platform, official hosts ONLY. */
const YT_CHANNEL_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'www.youtube.com', 'youtu.be'])

/** Named platforms a channel can point at (mirrors validators/channel.ts).
 *  Any other platform value is an admin-defined "Other" platform and
 *  only gets the generic https host check in parseChannelUrl. */
export type ChannelPlatform = 'youtube' | 'instagram' | 'pinterest' | 'facebook' | 'x' | 'whatsapp' | 'telegram'

export function isKnownChannelPlatform(platform: string): platform is ChannelPlatform {
  switch (platform) {
    case 'youtube':
    case 'instagram':
    case 'pinterest':
    case 'facebook':
    case 'x':
    case 'whatsapp':
    case 'telegram':
      return true
    default:
      return false
  }
}

function hostAllowed(platform: ChannelPlatform, host: string): boolean {
  switch (platform) {
    case 'youtube':
      return YT_CHANNEL_HOSTS.has(host)
    case 'instagram':
      return host === 'instagram.com' || host.endsWith('.instagram.com')
    case 'pinterest':
      return host === 'pinterest.com' || host.endsWith('.pinterest.com') || host === 'pin.it'
    case 'facebook':
      return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host === 'fb.me'
    case 'x':
      return host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')
    case 'whatsapp':
      return host === 'wa.me' || host === 'whatsapp.com' || host.endsWith('.whatsapp.com')
    case 'telegram':
      return host === 't.me' || host === 'telegram.me'
  }
}

/**
 * Validate an admin-pasted CHANNEL link (Feature A safety rule):
 * only the platform's official hosts are accepted; every other host
 * is rejected so nobody can add a fake or dangerous link. Returns
 * the normalized https URL or null.
 */
export function parseChannelUrl(rawUrl: string | null | undefined, platform: string = 'youtube'): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (isKnownChannelPlatform(platform)) {
    if (!hostAllowed(platform, host)) return null
  } else {
    // Custom "Other" platform — no brand whitelist exists, so require a
    // plausible public https host (dot in the name, not localhost-style).
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost')) return null
  }
  // page links must carry a path (e.g. /@handle or /c/name or /yourpage)
  if (parsed.pathname.length < 2) return null
  return `https://${host}${parsed.pathname}${parsed.search}`
}

/**
 * Append YouTube's subscribe-confirmation flag for the storefront
 * Subscribe button (`?sub_confirmation=1` — brief §A). Safe for
 * /@handle, /channel/, /c/ and youtu.be shapes alike.
 */
export function channelSubscribeUrl(url: string): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has('sub_confirmation')) u.searchParams.set('sub_confirmation', '1')
    return u.toString()
  } catch {
    return url
  }
}
