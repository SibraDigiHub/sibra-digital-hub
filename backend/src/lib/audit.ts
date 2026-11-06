// ═══════════════════════════════════════════════════════════
// Audit log (PRD v6.1 §11.10 / §13.1) — every admin mutation
// records who did what, to which entity, with a change summary.
// Writes are best-effort: never block the mutation itself.
// T4: adds a salted IP hash column (ipHash) for auth rows while
// the legacy raw `ip` column keeps audit continuity.
// ═══════════════════════════════════════════════════════════

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/auth/session'
import { hashIp } from '@/lib/auth/crypto'

export interface AuditInput {
  action: string
  entity: string
  entityId?: string | null
  label?: string | null
  diff?: Record<string, unknown> | null
  req?: NextRequest
  /** Raw ip string when the caller already has it (CLI/non-request contexts). */
  ip?: string
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const ip = input.req ? clientIp(input.req) : (input.ip ?? null)
    await db.auditLog.create({
      data: {
        action: input.action.slice(0, 80),
        entity: input.entity.slice(0, 40),
        entityId: input.entityId ?? null,
        label: input.label ? input.label.slice(0, 200) : null,
        diff: input.diff ? JSON.stringify(input.diff) : null,
        ip,
        ipHash: ip && ip !== 'unknown' ? hashIp(ip) : null,
      },
    })
  } catch {
    // audit must never break the actual admin mutation
  }
}

/** Mask an email for audit labels: ab***@domain (never log the full address). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}
