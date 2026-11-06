// GET /api/settings — public site settings
// PUT /api/settings — admin update
import { NextRequest } from 'next/server'
import { asHandler, cachedJson, json, parseBody } from '@/lib/api'
import { hasAdminSessionCookie, isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { writeAudit } from '@/lib/audit'
import { buildSettings, settingsUpdateSchema, updateSettings } from '@/services/content-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const settings = await buildSettings()
  // Admin updates must reflect immediately — no cache for admin requests.
  if (hasAdminSessionCookie(req)) return json({ settings })
  return cachedJson(req, { settings })
})

export const PUT = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const body = await parseBody(req, settingsUpdateSchema)
  const changed = await updateSettings(body)
  await writeAudit({
    action: 'settings.update',
    entity: 'settings',
    label: changed.join(', ') || 'no changes',
    diff: { keys: changed },
    req,
  })
  return json({ settings: await buildSettings() })
})
