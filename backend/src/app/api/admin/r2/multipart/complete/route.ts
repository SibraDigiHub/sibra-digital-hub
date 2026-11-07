import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import {
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3'

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
  R2_PART_SIZE,
} from '@/lib/r2'
import { sanitizeFileName } from '@/lib/storage'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  uploadToken: z.string().regex(/^[a-f0-9]{64}$/i),
  uploadId: z.string().min(1).max(1024),
  objectKey: z.string().min(1).max(1024),
  sizeBytes: z.number().int().positive().max(R2_MAX_BYTES),
}).strict()

export const POST = asHandler(async (req: NextRequest) => {
  const resolved = await requireAdmin(req)
  const ip = clientIp(req)

  const ipLimit = await consumeRateLimit(
    `r2:complete:ip:${hmacHex(ip)}`,
    10,
    15 * 60 * 1000,
  )
  if (!ipLimit.allowed) return tooMany(ipLimit.retryAfterSec)

  const sessionLimit = await consumeRateLimit(
    `r2:complete:session:${hmacHex(resolved.session.id)}`,
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

  if (!parsed.success || !isR2ObjectKey(parsed.data?.objectKey ?? '')) {
    return json({ error: 'Invalid multipart upload details.' }, { status: 400 })
  }

  const data = parsed.data
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
  const expectedParts = Math.ceil(data.sizeBytes / R2_PART_SIZE)

  const expectedAdmin = hmacHex(resolved.session.id)

  // Verify an already completed object. This also makes completion retries safe
  // when R2 completed the multipart upload but the original response was lost.
  const inspectCompletedObject = async () => {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: data.objectKey,
      }),
    )

    const actualAdmin = head.Metadata?.['admin-session'] ?? ''
    const adminMatches =
      actualAdmin.length === expectedAdmin.length &&
      timingSafeEqual(Buffer.from(actualAdmin), Buffer.from(expectedAdmin))

    const validContentType = [
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
    ].includes(head.ContentType ?? '')

    const valid =
      head.ContentLength === data.sizeBytes &&
      head.Metadata?.['expected-size'] === String(data.sizeBytes) &&
      adminMatches &&
      validContentType

    let fileName = 'download'
    try {
      fileName = sanitizeFileName(
        decodeURIComponent(head.Metadata?.['original-filename'] ?? ''),
      ) || fileName
    } catch {
      // Keep the safe fallback filename.
    }

    return { head, valid, fileName }
  }

  // Read the authoritative part list from R2; never trust browser ETags.
  let listed
  try {
    listed = await client.send(
      new ListPartsCommand({
        Bucket: bucketName,
        Key: data.objectKey,
        UploadId: data.uploadId,
        MaxParts: 1000,
      }),
    )
  } catch (listError) {
    // ListParts can fail after a previous CompleteMultipartUpload succeeded.
    // Recover only when the existing object passes every original check.
    try {
      const existing = await inspectCompletedObject()

      if (existing.valid) {
        return json({
          ok: true,
          deliverableUrl: `r2:${data.objectKey}`,
          fileName: existing.fileName,
          sizeBytes: existing.head.ContentLength,
          contentType: existing.head.ContentType,
        })
      }

      // An existing object that fails verification must never be retained.
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: data.objectKey,
        }),
      )

      return json(
        { error: 'Final R2 file verification failed. The uploaded object was removed.' },
        { status: 422 },
      )
    } catch (recoveryError) {
      if (
        recoveryError &&
        typeof recoveryError === 'object' &&
        'status' in recoveryError &&
        recoveryError.status === 422
      ) {
        throw recoveryError
      }

      // Preserve the original ListParts error if recovery is not possible.
    }

    throw listError
  }

  const uploadedParts = listed.Parts ?? []

  if (listed.IsTruncated || uploadedParts.length !== expectedParts) {
    return json(
      { error: 'Upload is incomplete. Please retry the missing parts.' },
      { status: 400 },
    )
  }

  const completedParts: Array<{ PartNumber: number; ETag: string }> = []
  let totalBytes = 0

  for (let index = 0; index < expectedParts; index++) {
    const part = uploadedParts[index]
    const expectedPartNumber = index + 1
    const expectedPartSize = Math.min(
      R2_PART_SIZE,
      data.sizeBytes - index * R2_PART_SIZE,
    )

    if (
      part.PartNumber !== expectedPartNumber ||
      !part.ETag ||
      part.Size !== expectedPartSize
    ) {
      return json(
        { error: 'Uploaded part validation failed. Please restart the upload.' },
        { status: 400 },
      )
    }

    totalBytes += part.Size
    completedParts.push({
      PartNumber: part.PartNumber,
      ETag: part.ETag,
    })
  }

  if (totalBytes !== data.sizeBytes) {
    return json({ error: 'Uploaded file size does not match.' }, { status: 400 })
  }

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: data.objectKey,
      UploadId: data.uploadId,
      MultipartUpload: { Parts: completedParts },
    }),
  )

  // Confirm the final private object and its server-created metadata.
  const { head, valid: validObject, fileName } = await inspectCompletedObject()

  if (!validObject) {
    // Remove an object that does not match the original upload metadata.
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: data.objectKey,
      }),
    )

    return json(
      { error: 'Final R2 file verification failed. The uploaded object was removed.' },
      { status: 422 },
    )
  }

  return json({
    ok: true,
    deliverableUrl: `r2:${data.objectKey}`,
    fileName,
    sizeBytes: head.ContentLength,
    contentType: head.ContentType,
  })
})
