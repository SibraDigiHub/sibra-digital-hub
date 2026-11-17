// Cloudflare R2 — private paid deliverables only.
// Server-side module. Never import this file from frontend code.

import { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/config/env'

export const R2_PRIVATE_PREFIX = 'private-deliverables/'
export const R2_MAX_BYTES = 300 * 1024 * 1024
export const R2_PART_SIZE = 16 * 1024 * 1024
export const R2_MAX_PARTS = Math.ceil(R2_MAX_BYTES / R2_PART_SIZE)

/** Validate the canonical HTTPS endpoint for this Cloudflare account. */
function validR2Endpoint(): boolean {
  if (!env.R2_ACCOUNT_ID || !env.R2_S3_ENDPOINT) return false

  try {
    const endpoint = new URL(env.R2_S3_ENDPOINT)
    return (
      /^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID) &&
      endpoint.protocol === 'https:' &&
      endpoint.hostname === `${env.R2_ACCOUNT_ID.toLowerCase()}.r2.cloudflarestorage.com` &&
      (endpoint.pathname === '' || endpoint.pathname === '/') &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash
    )
  } catch {
    return false
  }
}

/** R2 configuration is optional so missing credentials never break app boot. */
export function r2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME &&
    env.R2_REGION &&
    validR2Endpoint()
  )
}

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  endpoint: string
  region: string
}

export function getR2Config(): R2Config {
  if (!r2Configured()) {
    throw new Error('Cloudflare R2 is not configured')
  }

  return {
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucketName: env.R2_BUCKET_NAME!,
    endpoint: env.R2_S3_ENDPOINT!,
    region: env.R2_REGION,
  }
}

let client: S3Client | null = null

/** Lazily create one reusable server-side S3 client. */
export function getR2Client(): S3Client {
  if (client) return client

  const config = getR2Config()

  client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: false,
  })

  return client
}

/** Validate that an object key belongs to our private deliverables namespace. */
export function isR2ObjectKey(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(R2_PRIVATE_PREFIX) &&
    value.length > R2_PRIVATE_PREFIX.length &&
    value.length <= 1024 &&
    !value.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !value.split('/').some((segment) => segment === '.' || segment === '..')
  )
}

export const R2_REF_PREFIX = 'r2:'

export function isR2Ref(value: string): boolean {
  return typeof value === 'string' && value.startsWith(R2_REF_PREFIX)
}

export function parseR2Ref(value: string): string | null {
  if (!isR2Ref(value)) return null
  const key = value.slice(R2_REF_PREFIX.length)
  return isR2ObjectKey(key) ? key : null
}

/** Presign only after the caller has completed authorization and download claim. */
export async function r2SignedDownloadUrl(
  objectKey: string,
  options: { ttlSeconds?: number; fileName?: string } = {},
): Promise<string | null> {
  if (!isR2ObjectKey(objectKey) || !r2Configured()) return null

  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const { bucketName } = getR2Config()

  const rawName = options.fileName ?? ''
  const safeName = rawName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["\\\\]/g, '_')
    .trim() ?? ''

  const asciiFallback = safeName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[\r\n]/g, '_') || 'download'

  const encodedName = encodeURIComponent(safeName).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

  const contentDisposition = safeName
    ? `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`
    : undefined

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ...(contentDisposition
      ? { ResponseContentDisposition: contentDisposition }
      : {}),
  })

  return getSignedUrl(getR2Client(), command, {
    expiresIn: options.ttlSeconds ?? 600,
  })
}
