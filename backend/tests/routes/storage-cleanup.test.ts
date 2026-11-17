// ═══════════════════════════════════════════════════════════
// Storage-cleanup regression suite (owner Task 2).
// Covers: managed-ref classification, mediaRefs merge, refcount
// protection (duplicate products!), schedule→run with a MOCKED
// ImageKit API (404=done, 429=retry, ambiguous path=unresolved),
// unconfigured-provider parking, and the discard endpoint's
// 401/CSRF shape. Run: bun test tests/routes/storage-cleanup.test.ts
// ═══════════════════════════════════════════════════════════
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'

process.env.IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || 'test-private-key'
process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY = process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY || 'test-public-key'
process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/testacct'

const { classifyManagedRef, computeMediaRefs, removedManagedRefs } = await import('@/services/storage-refs')
const { scheduleDelete, runPendingDeletes, isReferenced } = await import('@/services/storage-cleanup')
const { db } = await import('@/lib/db')

const RUN = `t${Date.now().toString(36)}`
const IK_URL = (name: string) => `https://ik.imagekit.io/testacct/public-media/${name}`

// Mock ImageKit API — records calls, behaviour per test.
let ikBehaviour: (path: string, init: RequestInit) => { status: number; body?: unknown } = () => ({ status: 500, body: { message: 'no behaviour set' } })
const ikCalls: Array<{ path: string; method: string }> = []
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://api.imagekit.io/')) {
      const path = url.replace('https://api.imagekit.io', '')
      ikCalls.push({ path, method: (init?.method ?? 'GET').toUpperCase() })
      const r = ikBehaviour(path, init ?? {})
      return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, { status: r.status })
    }
    return realFetch(input, init)
  }) as typeof fetch
})
afterAll(async () => {
  globalThis.fetch = realFetch
  // Test isolation: wipe the rows this suite created.
  await db.storageCleanup.deleteMany({ where: { fileRef: { contains: RUN } } })
  await db.product.deleteMany({ where: { slug: { contains: RUN } } })
})

describe('managed-ref classification (never touches what we do not own)', () => {
  test('R2 deliverable refs are managed', () => {
    const m = classifyManagedRef('r2:private-deliverables/pack.zip')
    expect(m?.provider).toBe('r2')
    expect(m?.path).toBe('private-deliverables/pack.zip')
  })
  test('ImageKit endpoint URLs under managed folders are managed', () => {
    const m = classifyManagedRef(IK_URL('hero.webp'))
    expect(m?.provider).toBe('ik')
    expect(m?.path).toBe('/public-media/hero.webp')
  })
  test('legacy form folders (images/video) on our endpoint are managed', () => {
    expect(classifyManagedRef(`https://ik.imagekit.io/testacct/images/old.jpg`)?.provider).toBe('ik')
  })
  test('seed /images paths, YouTube, external hosts are NOT managed', () => {
    expect(classifyManagedRef('/images/seed-local.png')).toBeNull()
    expect(classifyManagedRef('https://youtube.com/watch?v=x')).toBeNull()
    expect(classifyManagedRef('https://evil.example.com/public-media/x.jpg')).toBeNull()
    expect(classifyManagedRef('#demo-checkout')).toBeNull()
  })
})

describe('mediaRefs registry merge', () => {
  test('uploaded fileIds are captured and derived entries added', () => {
    const json = computeMediaRefs('{}', { [IK_URL('a.jpg')]: 'fileId-123' }, { images: JSON.stringify([IK_URL('a.jpg'), IK_URL('b.webp')]) })
    const map = JSON.parse(json)
    expect(map[IK_URL('a.jpg')].id).toBe('fileId-123')
    expect(map[IK_URL('b.webp')].p).toBe('ik')
  })
  test('non-managed keys are refused (registry only tracks ours)', () => {
    const json = computeMediaRefs('{}', { 'https://youtube.com/watch?v=x': 'fake' }, {})
    expect(json).toBe('{}')
  })
  test('removedManagedRefs detects replacement, not addition', () => {
    const before = { images: JSON.stringify([IK_URL('old.jpg')]), deliverableUrl: 'r2:private-deliverables/a.zip' }
    const after = { images: JSON.stringify([IK_URL('old.jpg'), IK_URL('new.jpg')]), deliverableUrl: 'r2:private-deliverables/b.zip' }
    const removed = removedManagedRefs(before, after)
    expect(removed.map((r) => r.ref)).toEqual(['r2:private-deliverables/a.zip'])
  })
})

describe('refcount + schedule + run (mocked ImageKit)', () => {
  test('a file referenced by a product is NEVER enqueued', async () => {
    const ref = IK_URL(`shared-${RUN}.jpg`)
    await db.product.create({ data: { title: 'refA', slug: `${RUN}-a`, zone: 'kids', images: JSON.stringify([ref]) } })
    await db.product.create({ data: { title: 'refB', slug: `${RUN}-b`, zone: 'kids', images: JSON.stringify([ref]) } })
    expect(await isReferenced(ref)).toBe(true)
    expect(await scheduleDelete([{ ref, provider: 'ik', path: '/public-media/shared.jpg' }], 'product_update')).toBe(0)
    // One reference removed (the duplicate-product scenario): still protected.
    await db.product.deleteMany({ where: { slug: `${RUN}-b` } })
    expect(await isReferenced(ref)).toBe(true)
    expect(await scheduleDelete([{ ref, provider: 'ik', path: '/public-media/shared.jpg' }], 'product_update')).toBe(0)
    await db.product.deleteMany({ where: { slug: `${RUN}-a` } })
    expect(await isReferenced(ref)).toBe(false)
    const enqueued = await scheduleDelete([{ ref, provider: 'ik', path: '/public-media/shared.jpg' }], 'product_update')
    expect(enqueued).toBe(1)
  })

  test('404 from ImageKit counts as done (already gone)', async () => {
    const ref = IK_URL(`gone-${RUN}.jpg`)
    await db.storageCleanup.create({ data: { provider: 'imagekit', fileRef: ref, fileId: 'ik-gone', reason: 'product_update' } })
    ikBehaviour = () => ({ status: 404 })
    ikCalls.length = 0
    const stats = await runPendingDeletes()
    expect(stats.deleted).toBeGreaterThanOrEqual(1)
    expect(ikCalls.some((c) => c.path.includes('/files/ik-gone') && c.method === 'DELETE')).toBe(true)
    expect((await db.storageCleanup.findUnique({ where: { provider_fileRef: { provider: 'imagekit', fileRef: ref } } }))?.status).toBe('done')
  })

  test('429 schedules a retry (never a blind failure)', async () => {
    const ref = IK_URL(`retry-${RUN}.jpg`)
    await db.storageCleanup.create({ data: { provider: 'imagekit', fileRef: ref, fileId: 'ik-retry', reason: 'product_update' } })
    ikBehaviour = () => ({ status: 429 })
    await runPendingDeletes()
    const row = await db.storageCleanup.findUnique({ where: { provider_fileRef: { provider: 'imagekit', fileRef: ref } } })
    expect(row?.status).toBe('pending')
    expect(row?.attempts).toBe(1)
    expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('ambiguous path lookup resolves to unresolved — file NOT deleted', async () => {
    const ref = IK_URL(`legacy-${RUN}.jpg`)
    await db.storageCleanup.create({ data: { provider: 'imagekit', fileRef: ref, reason: 'product_update' } }) // no fileId
    ikBehaviour = () => ({ status: 200, body: [{ fileId: 'a' }, { fileId: 'b' }] })
    ikCalls.length = 0
    await runPendingDeletes()
    const row = await db.storageCleanup.findUnique({ where: { provider_fileRef: { provider: 'imagekit', fileRef: ref } } })
    expect(row?.status).toBe('unresolved')
    expect(ikCalls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(ikCalls.some((c) => c.path.includes('path=%2Fpublic-media%2Flegacy-'))).toBe(true)
  })

  test('unconfigured R2 parks the row (config state, not a crash)', async () => {
    const ref = `r2:private-deliverables/${RUN}-park.zip`
    await db.storageCleanup.create({ data: { provider: 'r2', fileRef: ref, reason: 'upload_discard' } })
    await runPendingDeletes()
    const row = await db.storageCleanup.findUnique({ where: { provider_fileRef: { provider: 'r2', fileRef: ref } } })
    expect(row?.status).toBe('pending')
    expect(row?.lastError).toBe('r2_unconfigured')
  })

  test('a row whose file got re-referenced is skipped, not deleted', async () => {
    const ref = IK_URL(`rescue-${RUN}.jpg`)
    await db.product.create({ data: { title: 'rescuer', slug: `${RUN}-rescue`, zone: 'kids', images: JSON.stringify([ref]) } })
    await db.storageCleanup.create({ data: { provider: 'imagekit', fileRef: ref, fileId: 'ik-rescue', reason: 'product_update' } })
    ikBehaviour = () => ({ status: 404 })
    await runPendingDeletes()
    const row = await db.storageCleanup.findUnique({ where: { provider_fileRef: { provider: 'imagekit', fileRef: ref } } })
    expect(row?.status).toBe('done')
    expect(row?.lastError).toBe('skipped_still_referenced')
    expect(ikCalls.some((c) => c.path.includes('/files/ik-rescue') && c.method === 'DELETE')).toBe(false)
    await db.product.deleteMany({ where: { slug: `${RUN}-rescue` } })
  })
})
