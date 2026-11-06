// T-V Feature A — admin channel edit/delete.
// PATCH  /api/admin/channels/[id] — update any field (URL re-whitelisted)
// DELETE /api/admin/channels/[id] — remove (storefront stops showing it)
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { writeAudit } from '@/lib/audit'
import { deleteChannel, updateChannel } from '@/services/channel-service'
import { channelUpdateSchema } from '@/validators/channel'

export const dynamic = 'force-dynamic'

export const PATCH = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  const input = await parseBody(req, channelUpdateSchema)
  const channel = await updateChannel(id, input)
  await writeAudit({
    action: 'channel.update',
    entity: 'Channel',
    entityId: id,
    label: channel.name,
    diff: input as Record<string, unknown>,
    req,
  })
  return json({ channel })
})

export const DELETE = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) throw unauthorized()
  const { id } = await params
  await deleteChannel(id)
  await writeAudit({ action: 'channel.delete', entity: 'Channel', entityId: id, req })
  return json({ ok: true })
})
