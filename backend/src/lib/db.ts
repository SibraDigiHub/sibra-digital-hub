import { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Single Prisma client per process (serverless-safe global cache in development).
// Query-level logging is intentionally off — it is noise in dev and a leak risk in production.
const prisma = new PrismaClient({
  log: ['warn', 'error', { emit: 'event', level: 'query' }],
})

// T3.6 observability: log only SLOW queries (> 100 ms). The SQL text is safe to
// log (no parameter values); `params` is deliberately never logged because it
// can carry emails/tokens.
const SLOW_QUERY_MS = 100
prisma.$on('query', (e) => {
  if (e.duration >= SLOW_QUERY_MS) {
    logger.warn({ ms: e.duration, query: e.query.slice(0, 200) }, 'slow query')
  }
})

export const db = prisma

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
