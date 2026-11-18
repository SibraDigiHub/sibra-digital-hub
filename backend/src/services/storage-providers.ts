// ═══════════════════════════════════════════════════════════
// Storage-cleanup §2 — provider delete clients (ImageKit + R2).
//
// Official APIs only, Basic auth with the ImageKit PRIVATE key,
// 10 s timeouts. 404 counts as success (already gone). 429/5xx/
// network failures are retryable — everything else is not.
// Never logs secrets; file refs (paths/ids) are fine.
// ═══════════════════════════════════════════════════════════

const IK_API_BASE = 'https://api.imagekit.io/v1'
const IK_TIMEOUT_MS = 10_000

export type ProviderResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'unresolved'; reason: string }
  | { kind: 'retryable'; status: number; message: string }
  | { kind: 'failed'; status: number; message: string }

function imagekitPrivateKey(): string | null {
  const key = process.env.IMAGEKIT_PRIVATE_KEY
  return key && key.trim() ? key : null
}

export function imagekitApiConfigured(): boolean {
  return imagekitPrivateKey() !== null
}

function ikHeaders(): HeadersInit {
  const key = imagekitPrivateKey() ?? ''
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  }
}

async function ikFetch(path: string, init: RequestInit): Promise<{ res: Response | null; err: string | null }> {
  try {
    const res = await fetch(`${IK_API_BASE}${path}`, { ...init, signal: AbortSignal.timeout(IK_TIMEOUT_MS) })
    return { res, err: null }
  } catch (e) {
    return { res: null, err: e instanceof Error ? e.message : 'network error' }
  }
}

function classifyIkStatus(status: number, message: string): ProviderResult {
  if (status === 404) return { kind: 'not_found' }
  if (status === 429 || status >= 500) return { kind: 'retryable', status, message }
  return { kind: 'failed', status, message }
}

/** DELETE /v1/files/:fileId — hard delete by id. */
export async function imagekitDeleteFile(fileId: string): Promise<ProviderResult> {
  if (!imagekitApiConfigured()) return { kind: 'unresolved', reason: 'imagekit_unconfigured' }
  const { res, err } = await ikFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: ikHeaders() })
  if (err) return { kind: 'retryable', status: 0, message: err }
  if (!res) return { kind: 'retryable', status: 0, message: 'no response' }
  if (res.ok) return { kind: 'ok' }
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  return classifyIkStatus(res.status, body?.message ?? `delete ${res.status}`)
}

/**
 * GET /v1/files?path=… — legacy refs without a fileId. Deletes are only
 * ever driven by an UNAMBIGUOUS single match; 0 or >1 hits ⇒ unresolved
 * and the file is left alone (reported, never blind-deleted).
 */
export async function imagekitFindFileIdByPath(path: string): Promise<ProviderResult & { fileId?: string }> {
  if (!imagekitApiConfigured()) return { kind: 'unresolved', reason: 'imagekit_unconfigured' }
  const q = `?path=${encodeURIComponent(path)}&limit=10`
  const { res, err } = await ikFetch(q, { method: 'GET', headers: ikHeaders() })
  if (err) return { kind: 'retryable', status: 0, message: err }
  if (!res) return { kind: 'retryable', status: 0, message: 'no response' }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    return classifyIkStatus(res.status, body?.message ?? `lookup ${res.status}`)
  }
  const arr = (await res.json().catch(() => null)) as Array<{ fileId?: string }> | null
  if (!Array.isArray(arr)) return { kind: 'unresolved', reason: 'malformed_lookup_response' }
  if (arr.length === 0) return { kind: 'not_found' }
  if (arr.length > 1 || !arr[0]?.fileId) return { kind: 'unresolved', reason: `ambiguous_path_matches(${arr.length})` }
  return { kind: 'ok', fileId: arr[0].fileId }
}

/**
 * POST /v1/files/purge_cache — best-effort CDN invalidation for public
 * media URLs after deletion. Failures are swallowed (the file is gone;
 * worst case the CDN serves the old object until TTL).
 */
export async function imagekitPurgeUrls(urls: string[]): Promise<void> {
  if (!imagekitApiConfigured() || urls.length === 0) return
  await ikFetch('/files/purge_cache', { method: 'POST', headers: ikHeaders(), body: JSON.stringify({ url: urls }) })
}

// ── Cloudflare R2 ───────────────────────────────────────────
export async function r2DeleteObject(objectKey: string): Promise<ProviderResult> {
  const { r2Configured } = await import('@/lib/r2')
  if (!r2Configured()) return { kind: 'unresolved', reason: 'r2_unconfigured' }
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const { getR2Client, getR2Config } = await import('@/lib/r2')
    const { bucketName } = getR2Config()
    await getR2Client().send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey }))
    return { kind: 'ok' } // R2 DeleteObject succeeds even when the key is absent
  } catch (e) {
    const message = e instanceof Error ? e.message : 'r2 delete failed'
    // AWS service errors (5xx-class) and throttling are retryable.
    const name = e instanceof Error ? e.name : ''
    const retryable = name.includes('ServiceUnavailable') || name.includes('Throttl') || name === 'AbortError' || /timeout|fetch failed/i.test(message)
    return retryable ? { kind: 'retryable', status: 0, message } : { kind: 'failed', status: 0, message }
  }
}
