// GET /api/payments/config — PUBLIC gateway config (§5.1): key IDs and
// booleans only — client secrets, webhook ids and merchant ids never leave.
import { NextResponse } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { paymentsConfig } from '@/services/checkout-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async () => json(paymentsConfig()))
