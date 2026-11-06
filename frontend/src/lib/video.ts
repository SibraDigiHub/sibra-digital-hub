// YouTube link parsing helpers — shared by the admin ProductForm live
// preview, the product detail page and the shop cards so a pasted
// YouTube URL embeds exactly the same way everywhere.

/** Extract the 11-char video id from any common YouTube URL shape, else null. */
export function youTubeId(url: string | null | undefined): string | null {
  if (!url) return null
  // Clipboard copies often carry invisible Unicode — strip it so the live
  // preview accepts exactly what the backend accepts (clean input: no-op).
  const trimmed = url.trim().replace(/[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g, '')
  if (!/^https?:\/\//i.test(trimmed)) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '')
  let id = ''
  if (host === 'youtu.be') {
    id = parsed.pathname.slice(1).split('/')[0]
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v') ?? ''
    } else {
      const m = parsed.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/)
      if (m) id = m[2]
    }
  }
  return /^[\w-]{5,}$/.test(id) ? id : null
}

/** YouTube URL → embed URL, or null when the URL is not a YouTube link. */
export function toYouTubeEmbedUrl(url: string | null | undefined): string | null {
  const id = youTubeId(url)
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}
