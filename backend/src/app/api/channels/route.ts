// GET /api/channels?zone=kids|creator — public channel directory (T-V A).
// Enabled channels of the REQUESTED zone only, in display order. A zone
// never sees the other zone's channels; an empty zone returns [] and the
// storefront renders nothing (no empty box). Cached like the categories API.
import { NextRequest } from 'next/server'
import { asHandler, cachedJson, json, parseQuery } from '@/lib/api'
import { hasAdminSessionCookie } from '@/lib/admin-auth'
import { listPublicChannels } from '@/services/channel-service'
import { channelListQuerySchema } from '@/validators/channel'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const query = parseQuery(req, channelListQuerySchema)
  const body = { channels: await listPublicChannels(query.zone ?? 'kids') }
  // Admin sessions bypass the ETag cache so panel edits show up instantly;
  // everyone else gets the same 60s public cache policy as categories.
  if (hasAdminSessionCookie(req)) return json(body)
  return cachedJson(req, body, { varyCookie: true })
})
