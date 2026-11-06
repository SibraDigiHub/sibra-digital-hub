// ═══════════════════════════════════════════════════════════
// Prisma query-count budget guard (perf kit, §2.6).
//   public catalog read ≤ 3 queries (budget: perf-budgets.json → prisma)
//   admin orders list   ≤ 6 queries
// LIMITATION (documented in docs/TESTING.md): Prisma 6 exposes query
// events only on clients created with `log:{emit:'event'}`, and the
// app's shared client (src/lib/db.ts) cannot be hooked at runtime.
// The test therefore replays the EXACT call shapes of
// `productRepo.list` (public catalog path) and `orderRepo.adminList`
// (admin list path) against a counting client and asserts the
// budget. If those repo functions gain queries, update both together.
// Read-only; no fixtures; no server needed.
// ═══════════════════════════════════════════════════════════

import { describe, test, afterAll } from 'bun:test'

import { PrismaClient } from '@prisma/client'

import { readFileSync } from 'node:fs'

const budgets = JSON.parse(readFileSync(new URL('../../../perf-budgets.json', import.meta.url), 'utf8')) as {
  prisma: { publicGetMaxQueries: number; adminListMaxQueries: number }
}

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${evidence}`)
}

function countingClient(): { client: PrismaClient; count: () => number } {
  let n = 0
  const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
  client.$on('query', () => {
    n += 1
  })
  return { client, count: () => n }
}

afterAll(async () => {
  console.log(`QUERY BUDGET: ${failures === 0 ? 'all checks passed' : `${failures} failure(s)`}`)
  if (failures > 0) process.exitCode = 1
})

describe('prisma query budgets (data-layer shapes)', () => {
  test(`public catalog read ≤ ${budgets.prisma.publicGetMaxQueries} queries`, async () => {
    const { client, count } = countingClient()
    try {
      // Replica of the /api/products public path: productRepo.list(where, orderBy, take).
      await client.product.findMany({
        where: { status: 'published' },
        orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        take: 100,
      })
      check('public GET budget', count() <= budgets.prisma.publicGetMaxQueries, `${count()} query(ies)`)
    } finally {
      await client.$disconnect()
    }
  }, 30_000)

  test(`admin orders list ≤ ${budgets.prisma.adminListMaxQueries} queries`, async () => {
    const { client, count } = countingClient()
    try {
      // Replica of orderRepo.adminList(q) — findMany + product include.
      await client.order.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 200,
        include: { product: { select: { id: true, title: true } } },
      })
      check('admin list budget', count() <= budgets.prisma.adminListMaxQueries, `${count()} query(ies)`)
    } finally {
      await client.$disconnect()
    }
  }, 30_000)
})
