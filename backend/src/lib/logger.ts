// Structured logger with secret redaction. Replaces console.* in backend code.
import pino from 'pino'
import { env } from '@/config/env'

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  '*.passcode',
  '*.password',
  '*.token',
  '*.tokenHash',
  '*.signature',
  '*.key_secret',
  '*.email',
  '*.customerEmail',
]

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: undefined, // no pid/hostname noise in serverless logs
})
