// /api/download/[token] — token-gated secure delivery (PRD §10.3.7, T5 §6).
//
//   GET  = VALIDATE ONLY — never consumes a download. The default mode
//          302-redirects to the on-site download page (SPA #/download/<token>)
//          where the buyer claims with one click; ?mode=json returns the same
//          validation shape the SPA uses. Email scanners and link prefetchers
//          can hit this any number of times without eating the buyer's quota
//          (audit §2.7: repeated GETs must not consume a download).
//   POST = THE CLAIM — validates, atomically claims one slot (updateMany with
//          downloadCount < max AND expiry AND status='paid'), then either
//          302-redirects straight to the file (default mode) or returns
//          { ok, fileUrl, name } (?mode=json). This is what the buyer's
//          download click uses.
//
// T5 hardening (unchanged):
//  • the claim is ATOMIC: `updateMany` increments downloadCount only while
//    `downloadCount < max AND tokenExpiresAt > now AND status = 'paid'` —
//    10 concurrent claims on a max-3 order yield exactly 3;
//  • error shapes (400/403/404/410/429 + messages) are unchanged;
//  • redirect targets are validated (relative path or https?:// only —
//    no javascript:/data: redirects); deliverableUrl and the token hash
//    never appear in any public response body.
//
// T6 (§7.1) ImageKit private files: at claim time the server mints a signed
// URL (HMAC-SHA256 over path+expire, 10-minute TTL — see lib/storage.ts) and
// it appears ONLY as the redirect Location header or in the token-validated
// ?mode=json SPA flow. Raw `ik:` paths/fileIds never leave the server.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tooMany, asHandler } from '@/lib/api'
import { env } from '@/config/env'
import { downloadLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { hashToken, claimDownload, maxDownloads } from '@/lib/delivery'
import { eventContext, logEvent } from '@/lib/activity'
import {
  PRIVATE_URL_TTL_SECONDS,
  isImagekitRef,
  imagekitSignedUrlFromRef,
} from '@/lib/storage'
import {
  isR2Ref,
  parseR2Ref,
  r2Configured,
  r2SignedDownloadUrl,
} from '@/lib/r2'

export const dynamic = 'force-dynamic'

type OrderRow = NonNullable<Awaited<ReturnType<typeof findOrder>>>

async function findOrder(token: string) {
  return db.order.findUnique({
    where: { downloadTokenHash: hashToken(token) },
    include: { product: true },
  })
}

/** Map an order row to the exact failure state (same shapes as always). */
function stateFor(order: OrderRow | null): { ok: false; error: string; status: number } | { ok: true; order: OrderRow } {
  if (!order || order.status !== 'paid') return { ok: false, error: 'This download link is not valid', status: 403 }
  // Fail closed: missing expiry must never bypass the atomic claim.
  if (!order.tokenExpiresAt || order.tokenExpiresAt <= new Date())
    return { ok: false, error: 'This download link has expired — contact us for a fresh link', status: 410 }
  if (!order.product?.deliverableUrl) return { ok: false, error: 'File missing — contact support', status: 404 }
  if (order.downloadCount >= maxDownloads())
    return { ok: false, error: `Download limit reached (${maxDownloads()}) — contact us to reset it`, status: 429 }
  return { ok: true, order }
}

async function validate(token: string): Promise<ReturnType<typeof stateFor>> {
  if (!token || token.length < 16) return { ok: false, error: 'Invalid download link', status: 400 }
  const order = await findOrder(token)
  return stateFor(order)
}

/**
 * Browser-facing redirect to the on-site SPA page. The base must be the
 * SITE origin (NEXT_PUBLIC_SITE_URL/PUBLIC_WEB_URL — the same canonical
 * origin the delivery emails use), never req.url: in the split
 * frontend/backend topology the API origin serves no SPA, so a req.url
 * based redirect sends the buyer's browser to a dead localhost:<api-port>
 * (ERR_CONNECTION_REFUSED). Dev falls back to the frontend dev server
 * (http://localhost:3000); req.url remains the last fallback only for
 * single-origin deployments where the API and SPA share one origin.
 */
function pageRedirect(req: NextRequest, path: string): NextResponse {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_WEB_URL ||
    // Dev fallback: with no env configured the SPA lives on the frontend
    // dev server (http://localhost:3000), NEVER on this API origin — a
    // req.url base behind the /api proxy resolves to localhost:<api-port>,
    // which serves no SPA (buyer sees ERR_CONNECTION_REFUSED or a 404
    // instead of the download page).
    (env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')
  const base = siteUrl && /^https?:\/\//.test(siteUrl) ? siteUrl : req.url
  return NextResponse.redirect(new URL(path, base), 302)
}

/** Redirect targets: relative paths or absolute http(s) URLs only. */
function safeRedirectTarget(deliverableUrl: string, req: NextRequest): string | null {
  if (deliverableUrl.startsWith('/')) return new URL(deliverableUrl, req.url).toString()
  try {
    const u = new URL(deliverableUrl)
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString()
  } catch {
    // not an absolute URL — fall through
  }
  return null
}

/** Resolve the redirect target server-side, after full validation. */
async function resolveTarget(
  deliverableUrl: string,
  req: NextRequest,
  fileName?: string | null,
): Promise<string | null> {
  if (isR2Ref(deliverableUrl)) {
    const objectKey = parseR2Ref(deliverableUrl)
    if (!objectKey) return null

    // R2 PRIVATE file → mint a 10-minute signed URL only after
    // the atomic download claim has succeeded.
    return r2SignedDownloadUrl(objectKey, {
      ttlSeconds: PRIVATE_URL_TTL_SECONDS,
      fileName: fileName ?? undefined,
    })
  }

  if (isImagekitRef(deliverableUrl)) {
    // Existing ImageKit private-file behavior remains unchanged.
    return imagekitSignedUrlFromRef(deliverableUrl)
  }

  return safeRedirectTarget(deliverableUrl, req)
}

/** Rate limit + validate + claim (shared by POST and the legacy GET default). */
async function claim(req: NextRequest, token: string): Promise<NextResponse> {
  const limit = await downloadLimitPerIp(clientIp(req))
  if (!limit.allowed) {
    if (req.nextUrl.searchParams.get('mode') === 'json') return tooMany(limit.retryAfterSec)
    return pageRedirect(req, `/#/download/${token}?error=${encodeURIComponent('Too many requests, try again shortly.')}`)
  }

  let result = await validate(token)
  if (!result.ok) return failResponse(req, token, result)

  // Validate private R2 references/configuration before consuming a download.
  // GET remains validation-only and never generates a signed URL.
  const deliverableUrlBeforeClaim = result.order.product.deliverableUrl!
  if (isR2Ref(deliverableUrlBeforeClaim)) {
    if (!parseR2Ref(deliverableUrlBeforeClaim) || !r2Configured()) {
      return NextResponse.json(
        { ok: false, error: 'File missing — contact support' },
        { status: 404 },
      )
    }
  }

  // ── Atomic claim: cap/expiry re-checked inside the UPDATE. ──
  const claimed = await claimDownload(hashToken(token), maxDownloads())
  if (claimed !== 1) {
    // Fail closed: never issue a file URL unless exactly one slot was claimed.
    const fresh = await findOrder(token)
    const freshState = stateFor(fresh)
    if (!freshState.ok) return failResponse(req, token, freshState)

    return failResponse(req, token, {
      ok: false,
      error: `Download limit reached (${maxDownloads()}) — contact us to reset it`,
      status: 429,
    })
  }

  await logDownload(req, result.order)

  const deliverableUrl = result.order.product.deliverableUrl!
  const target = await resolveTarget(
    deliverableUrl,
    req,
    result.order.product.deliverableName,
  )
  if (!target) return NextResponse.json({ ok: false, error: 'File missing — contact support' }, { status: 404 })

  if (req.nextUrl.searchParams.get('mode') === 'json') {
    // A relative deliverableUrl (e.g. /files/x.pdf) lives on the SITE origin
    // (frontend /public), not on this API origin. Hand the SPA the path
    // as-is so the buyer's browser resolves it against the origin it is
    // actually browsing — an absolute URL built from req.url would point
    // at this API host (loopback behind the /api proxy) and fail with
    // ERR_CONNECTION_REFUSED. ImageKit/absolute targets are unchanged.
    const fileUrl = deliverableUrl.startsWith('/') ? deliverableUrl : target
    return NextResponse.json({ ok: true, fileUrl, name: result.order.product.deliverableName })
  }
  return NextResponse.redirect(target, 302)
}

/** GET — validation only. Same failure shapes as before; success never claims. */
export const GET = asHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params
  const result = await validate(token)
  if (!result.ok) return failResponse(req, token, result)
  if (req.nextUrl.searchParams.get('mode') === 'json') {
    // The SPA download page validates for free, then claims via POST.
    return NextResponse.json({ ok: true, name: result.order.product.deliverableName, claimable: true })
  }
  // Email links / bookmarks point here — send humans to the claim page.
  return pageRedirect(req, `/#/download/${token}`)
})

/** POST — the claim (one download slot per successful call). */
export const POST = asHandler(async (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params
  return claim(req, token)
})

function failResponse(req: NextRequest, token: string, result: { ok: false; error: string; status: number }): NextResponse {
  if (req.nextUrl.searchParams.get('mode') === 'json') {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return pageRedirect(req, `/#/download/${token}?error=${encodeURIComponent(result.error)}`)
}

/** Funnel terminal step: file downloaded (analytics never breaks downloads). */
async function logDownload(req: NextRequest, order: OrderRow): Promise<void> {
  try {
    const ctx = eventContext(req)
    if (ctx.device !== 'bot') {
      await logEvent({
        type: 'download',
        productId: order.productId,
        zone: order.product.zone,
        email: order.customerEmail,
        orderId: order.id,
        visitorId: req.cookies.get('sdh_vid')?.value ?? order.visitorId,
        path: ctx.path,
        country: ctx.country,
        device: ctx.device,
      })
    }
  } catch {
    // analytics never breaks downloads
  }
}
