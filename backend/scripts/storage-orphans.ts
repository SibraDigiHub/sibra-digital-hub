// ═══════════════════════════════════════════════════════════
// scripts/storage-orphans.ts — managed-folder orphan scanner.
//
// Lists every file in OUR managed folders (ImageKit: public-media /
// public-video / private-deliverables / legacy images / video; R2:
// private-deliverables/) and prints the ones NOTHING in the database
// references. DRY-RUN BY DEFAULT — it only deletes when BOTH
// `--delete` AND `--older-than <days>` are passed, and even then it
// goes through the refcounted cleanup pipeline (isReferenced →
// StorageCleanup → runPendingDeletes), never a blind API call.
//
// NEVER scheduled by any cron — an admin runs it deliberately.
//
// Usage (from backend/):
//   bun scripts/storage-orphans.ts                     # dry-run report
//   bun scripts/storage-orphans.ts --delete --older-than 7
// Requires the relevant provider credentials in .env (providers
// without credentials are reported as "unconfigured — skipped").
// ═══════════════════════════════════════════════════════════
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { r2Configured, R2_PRIVATE_PREFIX } from '@/lib/r2'
import { classifyManagedRef, type ManagedRef } from '@/services/storage-refs'
import { isReferenced, runPendingDeletes, scheduleDelete } from '@/services/storage-cleanup'
import { imagekitApiConfigured } from '@/services/storage-providers'

const IK_API_BASE = 'https://api.imagekit.io/v1'
const IK_FOLDERS = ['public-media', 'public-video', 'private-deliverables', 'images', 'video']
const IK_PAGE = 1000

function imagekitPrivateKey(): string | null {
  const key = process.env.IMAGEKIT_PRIVATE_KEY
  return key && key.trim() ? key : null
}

function parseArgs(): { del: boolean; olderThanDays: number } {
  const argv = process.argv.slice(2)
  return {
    del: argv.includes('--delete'),
    olderThanDays: Number(argv[argv.indexOf('--older-than') + 1] ?? 0) || 0,
  }
}

interface ListedFile { ref: ManagedRef; createdAt: Date }

async function listImagekitFiles(folder: string): Promise<ListedFile[]> {
  const key = imagekitPrivateKey()
  if (!key) return []
  const out: ListedFile[] = []
  let offset = 0
  for (;;) {
    const q = `?path=${encodeURIComponent(`/${folder}`)}&limit=${IK_PAGE}${offset ? `&offset=${offset}` : ''}`
    const res = await fetch(`${IK_API_BASE}/files${q}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`ImageKit list failed (${res.status})`)
    const arr = (await res.json()) as Array<{ fileId: string; url?: string; createdAt?: string }>
    for (const f of arr) {
      const m = classifyManagedRef(f.url ?? '')
      if (m) out.push({ ref: { ...m, fileId: f.fileId }, createdAt: f.createdAt ? new Date(f.createdAt) : new Date(0) })
    }
    if (arr.length < IK_PAGE) break
    offset += IK_PAGE
  }
  return out
}

async function listR2Files(): Promise<ListedFile[]> {
  if (!r2Configured()) return []
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
  const { getR2Client, getR2Config } = await import('@/lib/r2')
  const { bucketName } = getR2Config()
  const out: ListedFile[] = []
  let token: string | undefined
  for (;;) {
    const page = await getR2Client().send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: R2_PRIVATE_PREFIX, MaxKeys: IK_PAGE, ...(token ? { ContinuationToken: token } : {}) }))
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue
      const m = classifyManagedRef(`r2:${o.Key}`)
      if (m) out.push({ ref: m, createdAt: o.LastModified ?? new Date(0) })
    }
    if (!page.IsTruncated || !page.NextContinuationToken) break
    token = page.NextContinuationToken
  }
  return out
}

async function main() {
  const args = parseArgs()
  if (args.del && args.olderThanDays <= 0) {
    console.error('--delete also requires --older-than <days> (age guard).')
    process.exit(1)
  }
  const cutoff = Date.now() - args.olderThanDays * 24 * 3600_000

  console.log('Scanning managed folders…')
  const candidates: ListedFile[] = []

  if (imagekitApiConfigured()) {
    for (const folder of IK_FOLDERS) {
      try {
        candidates.push(...(await listImagekitFiles(folder)))
      } catch (e) {
        console.error(`imagekit /${folder}: ${e instanceof Error ? e.message : e}`)
      }
    }
  } else {
    console.log('ImageKit unconfigured — skipped.')
  }

  if (r2Configured()) {
    try {
      candidates.push(...(await listR2Files()))
    } catch (e) {
      console.error(`r2: ${e instanceof Error ? e.message : e}`)
    }
  } else {
    console.log('R2 unconfigured — skipped.')
  }

  console.log(`Managed files found: ${candidates.length}. Checking references…`)
  const orphans: ListedFile[] = []
  for (const f of candidates) {
    if (!(await isReferenced(f.ref.ref))) orphans.push(f)
  }

  if (orphans.length === 0) {
    console.log('No orphans — every managed file is referenced. Nothing to do.')
    return
  }
  console.log(`ORPHANS (${orphans.length}):`)
  for (const f of orphans) {
    console.log(`  [${f.ref.provider}] ${f.ref.ref}${f.ref.fileId ? ` (fileId ${f.ref.fileId})` : ''} (created ${f.createdAt.toISOString()})`)
  }

  if (!args.del) {
    console.log('\nDry run — nothing was deleted. Pass --delete --older-than <days> to clean up.')
    return
  }

  const oldEnough = orphans.filter((f) => f.createdAt.getTime() <= cutoff)
  console.log(`\n${oldEnough.length} of ${orphans.length} orphan(s) pass the --older-than ${args.olderThanDays}d guard.`)
  if (oldEnough.length === 0) return
  const enqueued = await scheduleDelete(oldEnough.map((f) => f.ref), 'orphan_sweep')
  const stats = await runPendingDeletes()
  await writeAudit({ action: 'storage.orphan_sweep', entity: 'storage', diff: { orphans: orphans.length, enqueued, deleted: stats.deleted, unresolved: stats.unresolved } })
  console.log(`Enqueued ${enqueued}; deleted ${stats.deleted}; unresolved ${stats.unresolved}; retried ${stats.retried}.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
