import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { UploadPartCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { asHandler, json, readJsonCapped, tooMany } from '@/lib/api'
import { requireAdmin, clientIp } from '@/lib/auth/session'
import { consumeRateLimit } from '@/lib/auth/rate-limit'
import { hmacHex } from '@/lib/auth/crypto'
import {
  getR2Client,
  getR2Config,
  r2Configured,
  isR2ObjectKey,
  R2_MAX_BYTES,
  R2_MAX_PARTS,
  R2_PART_SIZE,
} from '@/lib/r2'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  uploadToken: z.string().regex(/^[a-f0-9]{64}$/i),
  uploadId: z.string().min(1).max(1024),
  objectKey: z.string().min(1).max(1024),
  sizeBytes: z.number().int().positive().max(R2_MAX_BYTES),
  partNumbers: z.array(
    z.number().int().min(1).max(R2_MAX_PARTS),
  ).min(1).max(R2_MAX_PARTS),
}).strict()

export const POST = asHandler(async (req: NextRequest) => {
  const resolved = await requireAdmin(req)
  const ip = clientIp(req)

  const ipLimit = await consumeRateLimit(
    `r2:sign:ip:${hmacHex(ip)}`,
    30,
    15 * 60 * 1000,
  )
  if (!ipLimit.allowed) return tooMany(ipLimit.retryAfterSec)

  const sessionLimit = await consumeRateLimit(
    `r2:sign:session:${hmacHex(resolved.session.id)}`,
    60,
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

  if (!parsed.success || !isR2ObjectKey(parsed.data?.objectKey ?? '')) {
    return json({ error: 'Invalid multipart upload details.' }, { status: 400 })
  }

  const data = parsed.data
  const expectedParts = Math.ceil(data.sizeBytes / R2_PART_SIZE)

  if (
    new Set(data.partNumbers).size !== data.partNumbers.length ||
    data.partNumbers.some((part) => part > expectedParts)
  ) {
    return json({ error: 'Invalid multipart part numbers.' }, { status: 400 })
  }

  const expectedToken = hmacHex([
    'r2-upload',
    resolved.session.id,
    data.objectKey,
    data.uploadId,
    String(data.sizeBytes),
  ].join('|'))

  const suppliedBuffer = Buffer.from(data.uploadToken, 'hex')
  const expectedBuffer = Buffer.from(expectedToken, 'hex')

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return json(
      { error: 'This upload does not belong to the current admin session.' },
      { status: 403 },
    )
  }

  const { bucketName } = getR2Config()
  const client = getR2Client()

  const parts = await Promise.all(
    data.partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: bucketName,
        Key: data.objectKey,
        UploadId: data.uploadId,
        PartNumber: partNumber,
      })

      return {
        partNumber,
        url: await getSignedUrl(client, command, { expiresIn: 3600 }),
      }
    }),
  )

  return json({ ok: true, parts })
})
