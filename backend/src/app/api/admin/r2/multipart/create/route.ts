import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { CreateMultipartUploadCommand } from '@aws-sdk/client-s3'

import { asHandler, json, readJsonCapped, tooMany } from '@/lib/api'
import { requireAdmin, clientIp } from '@/lib/auth/session'
import { consumeRateLimit } from '@/lib/auth/rate-limit'
import { hmacHex } from '@/lib/auth/crypto'
import {
  getR2Client,
  getR2Config,
  r2Configured,
  R2_PRIVATE_PREFIX,
  R2_MAX_BYTES,
  R2_PART_SIZE,
  R2_MAX_PARTS,
} from '@/lib/r2'
import { sanitizeFileName } from '@/lib/storage'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(120).nullable().optional(),
  sizeBytes: z.number().int().positive().max(R2_MAX_BYTES),
}).strict()

const MIME_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  zip: [
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ],
}

export const POST = asHandler(async (req: NextRequest) => {
  // Full admin session + CSRF validation.
  const resolved = await requireAdmin(req)

  // Strict PostgreSQL-backed rate limits.
  const ip = clientIp(req)

  const ipLimit = await consumeRateLimit(
    `r2:create:ip:${hmacHex(ip)}`,
    10,
    15 * 60 * 1000,
  )
  if (!ipLimit.allowed) return tooMany(ipLimit.retryAfterSec)

  const sessionLimit = await consumeRateLimit(
    `r2:create:session:${hmacHex(resolved.session.id)}`,
    20,
    15 * 60 * 1000,
  )
  if (!sessionLimit.allowed) return tooMany(sessionLimit.retryAfterSec)

  if (!r2Configured()) {
    return json(
      { error: 'Cloudflare R2 is not configured on the backend.' },
      { status: 503 },
    )
  }

  const body = await readJsonCapped(req)
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    return json({ error: 'Invalid upload details.' }, { status: 400 })
  }

  const safeName = sanitizeFileName(parsed.data.fileName)
  if (!safeName) {
    return json({ error: 'Invalid or unsafe file name.' }, { status: 400 })
  }

  const dot = safeName.lastIndexOf('.')
  const ext = dot > 0 ? safeName.slice(dot + 1).toLowerCase() : ''

  if (ext !== 'pdf' && ext !== 'zip') {
    return json(
      { error: 'Only PDF and ZIP files are allowed.' },
      { status: 400 },
    )
  }

  const suppliedMime = (parsed.data.mimeType ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim()

  if (suppliedMime && !MIME_TYPES[ext].includes(suppliedMime)) {
    return json(
      { error: 'File type does not match the allowed format.' },
      { status: 400 },
    )
  }

  const mimeType = suppliedMime || (
    ext === 'pdf' ? 'application/pdf' : 'application/zip'
  )

  const { bucketName } = getR2Config()
  const objectKey = `${R2_PRIVATE_PREFIX}${randomUUID()}/${safeName}`

  const result = await getR2Client().send(
    new CreateMultipartUploadCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: mimeType,
      Metadata: {
        'expected-size': String(parsed.data.sizeBytes),
        'original-filename': encodeURIComponent(safeName),
        'admin-session': hmacHex(resolved.session.id),
      },
    }),
  )

  if (!result.UploadId) {
    throw new Error('R2 did not return a multipart upload ID')
  }

  // Bind this multipart upload to the creating admin session.
  const uploadToken = hmacHex([
    'r2-upload',
    resolved.session.id,
    objectKey,
    result.UploadId,
    String(parsed.data.sizeBytes),
  ].join('|'))

  return json({
    ok: true,
    uploadToken,
    uploadId: result.UploadId,
    objectKey,
    fileName: safeName,
    mimeType,
    sizeBytes: parsed.data.sizeBytes,
    partSize: R2_PART_SIZE,
    maxParts: R2_MAX_PARTS,
  })
})
