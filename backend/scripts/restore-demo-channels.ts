// One-shot restore: recreate the two zone demo channels that were lost
// when the dev database was reset. Idempotent — skips if a channel with
// the same zone+name already exists. Owner can edit/remove these any
// time via Admin → Channels.
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

const DEMO_CHANNELS = [
  {
    zone: 'kids',
    name: 'Sibra Kids & Buddy',
    url: 'https://www.youtube.com/@SibraKidsBuddy',
    handle: '@SibraKidsBuddy',
    description: 'Fun learning, stories & rhymes for little minds.',
    audienceTag: 'Ages 2–6',
    buttonText: 'Subscribe',
    sortOrder: 0,
    enabled: true,
  },
  {
    zone: 'creator',
    name: 'Sibra Creator Lab',
    url: 'https://www.youtube.com/@SibraCreatorLab',
    handle: '@SibraCreatorLab',
    description: 'Templates, prompts & web designs that sell.',
    audienceTag: null,
    buttonText: 'Subscribe',
    sortOrder: 0,
    enabled: true,
  },
]

async function main() {
  for (const c of DEMO_CHANNELS) {
    const existing = await p.channel.findFirst({ where: { zone: c.zone, name: c.name } })
    if (existing) {
      console.log(`SKIP (already exists): [${c.zone}] ${c.name}`)
      continue
    }
    const created = await p.channel.create({ data: c })
    console.log(`CREATED: id=${created.id} [${created.zone}] ${created.name} → ${created.url}`)
  }
  const total = await p.channel.count()
  console.log('TOTAL CHANNELS NOW:', total)
  await p.$disconnect()
}

main().catch((e) => {
  console.error('ERR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
