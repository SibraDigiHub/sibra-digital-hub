// ═══════════════════════════════════════════════════════════
// Shared HTTP helpers for admin auth routes — uniform Zod
// validation (strictObject), uniform error JSON, no stack traces.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'

/** Parse + validate a JSON body with a strict schema. Returns a ready 400 response on failure. */
export async function parseJsonBody<T>(req: Request, schema: ZodType<T>): Promise<T | NextResponse> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }
  return parsed.data
}

export function jsonError(message: string, status: number, code?: string): NextResponse {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status })
}

export const GENERIC_LOGIN_ERROR = 'Invalid email or password'
export const GENERIC_CODE_ERROR = 'Invalid code'
