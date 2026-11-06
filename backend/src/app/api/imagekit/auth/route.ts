// GET /api/imagekit/auth — signed browser-upload params (PRD §13.3, T6 §7.1)
//
// ADMIN-ONLY when ImageKit is configured (valid FULL admin session).
// The ImageKit private key never leaves the backend; the response
// carries short-lived signed parameters for DIRECT browser uploads.
//
// Folder scoping per upload kind (§7.1):
//   ?kind=media       → public-media        (jpg/jpeg/png/webp/gif, ≤25 MB)
//   ?kind=video       → public-video        (mp4/webm, ≤25 MB)
//   ?kind=deliverable → private-deliverables (pdf/zip/apk/epub/txt, ≤100 MB)
// An optional &fileName= is pre-validated against the allow-list so the
// admin form fails fast (the browser upload itself is enforced by
// ImageKit's own limits).
//
// 501 + { fallback: true } when ImageKit is NOT configured — byte-identical
// to the pre-T6 shape (contract golden `imagekit-auth-nokey`), so the admin
// form automatically falls back. Deliberately checked BEFORE the admin
// guard: the unconfigured response carries no secrets.
import { NextRequest, NextResponse } from 'next/server'
import { tooMany, asHandler } from '@/lib/api'
import { isAdmin, unauthorized } from '@/lib/admin-auth'
import { imagekitSignLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import {
  UPLOAD_KINDS,
  type UploadKind,
  imagekitAuthParams,
  folderForKind,
  validateUpload,
  MEDIA_MAX_BYTES,
  DELIVERABLE_MAX_BYTES,
} from '@/lib/storage'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const configured = Boolean(
    process.env.IMAGEKIT_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY &&
      process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT,
  )

  if (!configured) {
    return NextResponse.json(
      { fallback: true, error: 'ImageKit not configured — using local upload fallback' },
      { status: 501 },
    )
  }

  // Configured ⇒ signing parameters are sensitive: admin session required.
  if (!(await isAdmin())) return unauthorized()

  // T7 (§8.2): 30 signing calls/min per IP (PG-backed, fail-open) — stops
  // signature-minting loops; the admin form signs once per upload.
  const limit = await imagekitSignLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const kindParam = (req.nextUrl.searchParams.get('kind') ?? 'media') as UploadKind
  if (!UPLOAD_KINDS.includes(kindParam)) {
    return NextResponse.json(
      { error: `kind must be one of: ${UPLOAD_KINDS.join(', ')}` },
      { status: 400 },
    )
  }

  // Optional fail-fast validation of the file the admin is about to upload.
  const fileName = req.nextUrl.searchParams.get('fileName')
  if (fileName) {
    const v = validateUpload(kindParam, { fileName })
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })
  }

  const params = imagekitAuthParams()
  return NextResponse.json({
    ...params,
    kind: kindParam,
    folder: folderForKind(kindParam),
    limits: { mediaMaxBytes: MEDIA_MAX_BYTES, deliverableMaxBytes: DELIVERABLE_MAX_BYTES },
  })
})
