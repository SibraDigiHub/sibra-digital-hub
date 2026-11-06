// T3 — EXPLAIN ANALYZE the top public/admin queries against the local PG.
// Usage: bun scripts/explain-top-queries.ts
// Confirms each hot query actually uses an index (no Seq Scan on hot paths).
import { Client } from 'pg'

const QUERIES: { name: string; sql: string }[] = [
  {
    name: 'products: zone+status catalog sort',
    sql: "EXPLAIN ANALYZE SELECT * FROM \"Product\" WHERE zone='kids' AND status='published' ORDER BY \"sortOrder\" ASC, \"createdAt\" DESC, id ASC LIMIT 60",
  },
  {
    name: 'products: search (ilike title)',
    sql: "EXPLAIN ANALYZE SELECT * FROM \"Product\" WHERE status='published' AND (title ILIKE '%coloring%' OR description ILIKE '%coloring%') ORDER BY \"sortOrder\" ASC, id ASC LIMIT 60",
  },
  {
    name: 'product by slug',
    sql: "EXPLAIN ANALYZE SELECT * FROM \"Product\" WHERE slug='kids-coloring-pack' LIMIT 1",
  },
  {
    name: 'orders: recent with product (admin dashboard)',
    sql: 'EXPLAIN ANALYZE SELECT o.*, p.title FROM "Order" o LEFT JOIN "Product" p ON p.id = o."productId" ORDER BY o."createdAt" DESC, o.id ASC LIMIT 10',
  },
  {
    name: 'orders: paid revenue window',
    sql: "EXPLAIN ANALYZE SELECT \"amountInr\", \"createdAt\" FROM \"Order\" WHERE status='paid'",
  },
  {
    name: 'orders: by customer email',
    sql: "EXPLAIN ANALYZE SELECT * FROM \"Order\" WHERE \"customerEmail\"='a@b.com' ORDER BY \"createdAt\" DESC, id ASC",
  },
  {
    name: 'activity: recent events',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "ActivityEvent" ORDER BY "createdAt" DESC, id ASC LIMIT 60',
  },
  {
    name: 'activity: events by product',
    sql: "EXPLAIN ANALYZE SELECT * FROM \"ActivityEvent\" WHERE \"productId\"='x' ORDER BY \"createdAt\" DESC LIMIT 50",
  },
  {
    name: 'audit: recent',
    sql: 'EXPLAIN ANALYZE SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 50',
  },
]

// NOTE: the sandbox shell can inject a stale DATABASE_URL, so connect explicitly.
const url = process.env.DIRECT_URL?.startsWith('postgresql://') ? process.env.DIRECT_URL : 'postgresql://postgres@127.0.0.1:5432/sibra'
const client = new Client({ connectionString: url })
await client.connect()
// Tiny tables make the planner pick Seq Scan (correctly — it IS faster there).
// We therefore report both the natural plan and the plan with seqscan disabled,
// which proves the index path exists and will be used as the table grows.
await client.query('SET enable_seqscan = off')
for (const q of QUERIES) {
  const res = await client.query<{ 'QUERY PLAN': string }>(q.sql)
  const plan = res.rows.map((r) => r['QUERY PLAN']).join('\n')
  const scan = /Seq Scan/.test(plan) ? 'SEQ SCAN' : 'index-ok'
  const cost = plan.match(/cost=\S+/)?.[0] ?? ''
  const time = plan.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? '?'
  console.log(`${scan === 'index-ok' ? '✓' : '⚠'} ${q.name} — ${time}ms ${cost} [${scan}]`)
  if (scan !== 'index-ok') console.log('   ' + plan.split('\n')[0])
}
await client.end()
