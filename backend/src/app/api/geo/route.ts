// GET /api/geo — geo-smart checkout ordering (PRD §10.1)
// IP/derived per-request data → always `no-store` (asHandler default).
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const country =
    req.headers.get('x-vercel-ip-country') ||
    req.headers.get('cf-ipcountry') ||
    (req.headers.get('accept-language')?.includes('en-IN') ? 'IN' : null) ||
    'US'
  return NextResponse.json({ country, isIndia: country === 'IN' })
})
