// T-V Feature A — admin YouTube-channel directory.
// GET  /api/admin/channels          — full list (both zones, incl. disabled)
// POST /api/admin/channels          — create (URL whitelist: YouTube only)
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody, parseQuery } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { writeAudit } from '@/lib/audit'
import { adminListChannels, createChannel } from '@/services/channel-service'
import { channelCreateSchema, channelListQuerySchema } from '@/validators/channel'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const query = parseQuery(req, channelListQuerySchema)
  return json({ channels: await adminListChannels(query.zone) })
})

export const POST = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const input = await parseBody(req, channelCreateSchema)
  const channel = await createChannel(input)
  await writeAudit({
    action: 'channel.create',
    entity: 'Channel',
    entityId: channel.id,
    label: channel.name,
    diff: { zone: channel.zone, url: channel.url, sortOrder: channel.sortOrder, enabled: channel.enabled },
    req,
  })
  return json({ channel }, { status: 201 })
})
