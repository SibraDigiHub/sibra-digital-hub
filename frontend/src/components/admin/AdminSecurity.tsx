'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Security section (T4-b §5.11), rendered inside the
// existing Settings tab. Owns:
//   • change password (step-up = current password)
//   • authenticator app manage (enroll / disable with step-up)
//   • passkeys (list, add via WebAuthn, remove with step-up)
//   • recovery codes (remaining count, regenerate with step-up)
//   • active sessions + "log out all other sessions"
//   • recent security events (read-only, filtered from audit)
// Destructive actions refuse to remove the LAST factor — the
// backend error is surfaced verbatim.
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import AdminRecoveryCodes from '@/components/admin/AdminRecoveryCodes'
import {
  adminFetch,
  adminJson,
  type AdminPasskey,
  type AdminSecurityInfo,
  type AdminSessionRow,
} from '@/lib/admin-api'
import { startRegistration } from '@simplewebauthn/browser'

interface AuditRow {
  id: string
  action: string
  entity: string
  label: string | null
  createdAt: string
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Inline password step-up used by every destructive security action. */
function StepUpForm({
  actionLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  actionLabel: string
  busy: boolean
  onConfirm: (password: string) => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  return (
    <form
      className="mt-3 flex flex-col gap-2 rounded-xl border border-dashed border-white/15 p-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (password) onConfirm(password)
      }}
    >
      <div className="flex-1">
        <Label htmlFor={`stepup-${actionLabel.replace(/\s+/g, '-').toLowerCase()}`} className="text-xs text-[#9AA89E]">
          Confirm your password to {actionLabel.toLowerCase()}
        </Label>
        <div className="relative mt-1">
          <Input
            id={`stepup-${actionLabel.replace(/\s+/g, '-').toLowerCase()}`}
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
            className="h-9 pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-[#9AA89E] hover:text-[#F5F8F6]"
          >
            {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !password} className="h-9 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
          Confirm
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-9 text-[#9AA89E]" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export default function AdminSecurity({
  security,
  onChanged,
}: {
  security: AdminSecurityInfo | null
  onChanged: () => void
}) {
  const { toast } = useToast()

  // ── change password ──
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  // ── authenticator ──
  const [enrolling, setEnrolling] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [enrollCode, setEnrollCode] = useState('')
  const [disabling, setDisabling] = useState(false)

  // ── passkeys ──
  const [passkeys, setPasskeys] = useState<AdminPasskey[] | null>(null)
  const [addingPasskey, setAddingPasskey] = useState(false)
  const [passkeyName, setPasskeyName] = useState('')
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null)

  // ── recovery codes ──
  const [regenerating, setRegenerating] = useState(false)
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null)

  // ── sessions ──
  const [sessions, setSessions] = useState<AdminSessionRow[] | null>(null)
  const [revokingOthers, setRevokingOthers] = useState(false)

  // ── security events ──
  const [events, setEvents] = useState<AuditRow[] | null>(null)

  const [busyAction, setBusyAction] = useState<string | null>(null)

  // Bump to re-fetch passkeys/sessions/events (list-affecting actions).
  const [reloadKey, setReloadKey] = useState(0)
  const refreshLists = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    adminJson<{ passkeys: AdminPasskey[] }>('/api/admin/passkeys')
      .then((d) => {
        if (alive) setPasskeys(d.passkeys)
      })
      .catch(() => {
        if (alive) setPasskeys([])
      })
    adminJson<{ sessions: AdminSessionRow[] }>('/api/admin/sessions')
      .then((d) => {
        if (alive) setSessions(d.sessions)
      })
      .catch(() => {
        if (alive) setSessions([])
      })
    adminJson<{ logs: AuditRow[] }>('/api/admin/audit')
      .then((d) => {
        // Read-only view: only auth-related actions, newest first.
        if (alive) setEvents(d.logs.filter((l) => l.action.startsWith('auth.')).slice(0, 40))
      })
      .catch(() => {
        if (alive) setEvents([])
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  function fail(err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : fallback
    toast({ title: message, variant: 'destructive' })
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (changingPw || !currentPassword || !newPassword) return
    setChangingPw(true)
    try {
      const d = await adminJson<{ ok: boolean; otherSessionsRevoked: number }>('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setCurrentPassword('')
      setNewPassword('')
      toast({
        title: 'Password changed',
        description: d.otherSessionsRevoked > 0 ? `${d.otherSessionsRevoked} other session(s) signed out.` : undefined,
      })
      onChanged()
    } catch (err) {
      fail(err, 'Could not change password')
    } finally {
      setChangingPw(false)
    }
  }

  async function startEnroll() {
    setBusyAction('enroll')
    try {
      const d = await adminJson<{ qrDataUrl: string; secret: string }>('/api/admin/2fa/enroll', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setQr(d.qrDataUrl)
      setSecret(d.secret)
      setEnrolling(true)
    } catch (err) {
      fail(err, 'Could not start enrollment')
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollCode.trim()) return
    setBusyAction('confirm')
    try {
      const d = await adminJson<{ ok: boolean; recoveryCodes?: string[] | null }>('/api/admin/2fa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: enrollCode.trim() }),
      })
      setEnrolling(false)
      setQr(null)
      setSecret(null)
      setEnrollCode('')
      onChanged()
      if (d.recoveryCodes && d.recoveryCodes.length > 0) {
        setFreshCodes(d.recoveryCodes)
      } else {
        toast({ title: 'Authenticator app enabled' })
      }
    } catch (err) {
      fail(err, 'Invalid code')
    } finally {
      setBusyAction(null)
    }
  }

  async function disableTotp(password: string) {
    setBusyAction('disable')
    try {
      await adminJson<{ ok: boolean }>('/api/admin/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setDisabling(false)
      toast({ title: 'Authenticator app disabled' })
      onChanged()
    } catch (err) {
      fail(err, 'Could not disable authenticator')
    } finally {
      setBusyAction(null)
    }
  }

  async function addPasskey(e: React.FormEvent) {
    e.preventDefault()
    if (addingPasskey) return
    setAddingPasskey(true)
    try {
      if (typeof navigator === 'undefined' || !navigator.credentials || !window.isSecureContext) {
        throw new Error('Passkeys are not available on this device or browser')
      }
      const opts = await adminJson<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
        '/api/admin/passkeys/register/options',
        { method: 'POST', body: JSON.stringify({}) },
      )
      const name = (passkeyName.trim() || 'Passkey').slice(0, 60)
      const attestation = await startRegistration({ optionsJSON: opts.options })
      const d = await adminJson<{ ok: boolean; recoveryCodes?: string[] | null }>('/api/admin/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify({ response: attestation, name }),
      })
      setPasskeyName('')
      refreshLists()
      onChanged()
      if (d.recoveryCodes && d.recoveryCodes.length > 0) {
        setFreshCodes(d.recoveryCodes)
      } else {
        toast({ title: `Passkey “${name}” added` })
      }
    } catch (err) {
      fail(err, 'Passkey registration failed')
    } finally {
      setAddingPasskey(false)
    }
  }

  async function removePasskey(password: string) {
    if (!removingPasskeyId) return
    setBusyAction(`passkey-${removingPasskeyId}`)
    try {
      await adminJson<{ ok: boolean }>(`/api/admin/passkeys/${encodeURIComponent(removingPasskeyId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      })
      setRemovingPasskeyId(null)
      refreshLists()
      onChanged()
      toast({ title: 'Passkey removed' })
    } catch (err) {
      fail(err, 'Could not remove passkey')
    } finally {
      setBusyAction(null)
    }
  }

  async function regenerateCodes(password: string) {
    setBusyAction('recovery')
    try {
      const d = await adminJson<{ codes: string[]; remaining: number }>('/api/admin/recovery-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setRegenerating(false)
      setFreshCodes(d.codes)
      onChanged()
    } catch (err) {
      fail(err, 'Could not regenerate recovery codes')
    } finally {
      setBusyAction(null)
    }
  }

  async function revokeOthers() {
    setRevokingOthers(true)
    try {
      const d = await adminJson<{ ok: boolean; revoked: number }>('/api/admin/sessions', { method: 'DELETE' })
      refreshLists()
      toast({ title: `${d.revoked} other session(s) signed out` })
    } catch (err) {
      fail(err, 'Could not sign out other sessions')
    } finally {
      setRevokingOthers(false)
    }
  }

  const totpEnabled = security?.totpEnabled ?? false
  const remaining = security?.recoveryCodesRemaining ?? 0

  return (
    <div className="space-y-5">
      <header>
        <h2 className="font-cinzel text-xl text-[#E5B842]">Security</h2>
        <p className="text-sm text-[#9AA89E]">Sign-in, second factors, passkeys, recovery codes and active sessions.</p>
      </header>

      {/* Fresh recovery codes — shown once (enroll or regenerate) */}
      {freshCodes && (
        <section className="glass rounded-2xl p-5">
          <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Your new recovery codes</h3>
          <p className="mt-1 text-xs text-[#9AA89E]">All previous codes were invalidated.</p>
          <div className="mt-4">
            <AdminRecoveryCodes
              codes={freshCodes}
              doneLabel="I saved them"
              onDone={() => setFreshCodes(null)}
            />
          </div>
        </section>
      )}

      {/* ── a) Change password ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Change Password</h3>
        <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1.5 h-10"
            />
          </div>
          <div>
            <Label htmlFor="pw-new">New password</Label>
            <div className="relative mt-1.5">
              <Input
                id="pw-new"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={12}
                className="h-10 pr-11"
              />
              <button
                type="button"
                onClick={() => setShowNew((s) => !s)}
                aria-label={showNew ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-[#9AA89E] hover:text-[#F5F8F6]"
              >
                {showNew ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-[#9AA89E]">
              {newPassword.length === 0
                ? 'Minimum 12 characters — longer is stronger.'
                : newPassword.length < 12
                  ? `${12 - newPassword.length} more character${12 - newPassword.length === 1 ? '' : 's'} needed.`
                  : 'Length OK — mixing cases, digits and symbols strengthens it.'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={changingPw || !currentPassword || !newPassword}
              className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {changingPw ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
              Update password
            </Button>
            <p className="mt-2 text-xs text-[#9AA89E]">Changing the password signs out every other session.</p>
          </div>
        </form>
      </section>

      {/* ── b) Authenticator app ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Authenticator App</h3>
        {enrolling && qr && secret ? (
          <form onSubmit={confirmEnroll} className="mt-4 space-y-3">
            <div className="flex flex-col items-center">
              {/* Backend-rendered QR (qrcode data URL, 240px) */}
              <img
                src={qr}
                alt="QR code with the authenticator secret — scan it with your authenticator app"
                width={220}
                height={220}
                className="rounded-xl bg-white p-2"
              />
              <p className="mt-2 text-center text-[11px] text-[#9AA89E]">Manual key:</p>
              <code className="select-all break-all rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-center font-mono text-xs text-[#F5F8F6]">
                {secret}
              </code>
            </div>
            <div className="mx-auto max-w-xs">
              <Label htmlFor="sec-enroll-code" className="sr-only">
                Authenticator code
              </Label>
              <Input
                id="sec-enroll-code"
                inputMode="numeric"
                pattern="\d*"
                maxLength={10}
                value={enrollCode}
                onChange={(e) => setEnrollCode(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="6-digit code"
                autoComplete="one-time-code"
                className="h-10 text-center font-mono text-lg tracking-[0.4em]"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={busyAction === 'confirm' || enrollCode.length < 6}
                className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
              >
                {busyAction === 'confirm' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                Confirm
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 text-[#9AA89E]"
                onClick={() => {
                  setEnrolling(false)
                  setQr(null)
                  setSecret(null)
                  setEnrollCode('')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge
              className={
                totpEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/20 bg-white/10 text-[#C9D2CB]'
              }
            >
              {totpEnabled ? '✓ Enabled' : 'Not set up'}
            </Badge>
            {!totpEnabled && (
              <Button
                variant="outline"
                className="h-10"
                disabled={busyAction === 'enroll'}
                onClick={() => void startEnroll()}
              >
                {busyAction === 'enroll' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Smartphone className="size-4" aria-hidden="true" />
                )}
                Set up authenticator
              </Button>
            )}
            {totpEnabled && !disabling && (
              <Button variant="outline" className="h-10 hover:text-red-300" onClick={() => setDisabling(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                Disable
              </Button>
            )}
          </div>
        )}
        {totpEnabled && disabling && (
          <StepUpForm
            actionLabel="disable the authenticator app"
            busy={busyAction === 'disable'}
            onConfirm={(password) => void disableTotp(password)}
            onCancel={() => setDisabling(false)}
          />
        )}
      </section>

      {/* ── c) Passkeys ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Passkeys</h3>
        {security?.passkeysEnabled === false && (
          <p className="mt-3 text-xs text-amber-200">Passkeys are disabled on this server (ADMIN_PASSKEYS_ENABLED).</p>
        )}
        {!passkeys ? (
          <Skeleton className="mt-4 h-16 rounded-xl" />
        ) : passkeys.length === 0 ? (
          <p className="mt-3 text-sm text-[#9AA89E]">No passkeys registered yet.</p>
        ) : (
          <ul className="nice-scroll mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
                <Fingerprint className="size-5 shrink-0 text-[#E5B842]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-[#9AA89E]">
                    Added {fmtDate(p.createdAt)} · Last used {fmtDate(p.lastUsedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 hover:text-red-300"
                  disabled={busyAction === `passkey-${p.id}`}
                  onClick={() => setRemovingPasskeyId(p.id)}
                  aria-label={`Remove passkey ${p.name}`}
                >
                  {busyAction === `passkey-${p.id}` ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {removingPasskeyId && (
          <StepUpForm
            actionLabel="remove this passkey"
            busy={busyAction === `passkey-${removingPasskeyId}`}
            onConfirm={(password) => void removePasskey(password)}
            onCancel={() => setRemovingPasskeyId(null)}
          />
        )}

        <form onSubmit={addPasskey} className="mt-4 grid gap-3 rounded-xl border border-dashed border-white/15 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="passkey-name">Add a passkey — device name</Label>
            <Input
              id="passkey-name"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              placeholder="e.g. MacBook Touch ID"
              maxLength={60}
              className="mt-1.5 h-10"
            />
          </div>
          <Button type="submit" disabled={addingPasskey || security?.passkeysEnabled === false} className="h-10">
            {addingPasskey ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            Add passkey
          </Button>
        </form>
      </section>

      {/* ── d) Recovery codes ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Recovery Codes</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge className={remaining <= 3 ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-white/20 bg-white/10 text-[#C9D2CB]'}>
            {remaining} remaining
          </Badge>
          {remaining <= 3 && security && (
            <span className="flex items-center gap-1.5 text-xs text-amber-200">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              Low — consider regenerating.
            </span>
          )}
          {!regenerating && (
            <Button variant="outline" className="h-10" disabled={busyAction === 'recovery'} onClick={() => setRegenerating(true)}>
              {busyAction === 'recovery' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              Regenerate codes
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-[#9AA89E]">
          Each code works once as a sign-in second factor. Regenerating invalidates all previous codes.
        </p>
        {regenerating && (
          <StepUpForm
            actionLabel="regenerate recovery codes"
            busy={busyAction === 'recovery'}
            onConfirm={(password) => void regenerateCodes(password)}
            onCancel={() => setRegenerating(false)}
          />
        )}
      </section>

      {/* ── e) Active sessions ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Active Sessions</h3>
        {!sessions ? (
          <Skeleton className="mt-4 h-16 rounded-xl" />
        ) : (
          <ul className="mt-4 space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3">
                <MonitorSmartphone className="size-5 shrink-0 text-[#9AA89E]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Device <span className="font-mono text-xs text-[#9AA89E]">{s.device}</span>
                    {s.current && (
                      <Badge className="ml-2 border-emerald-500/40 bg-emerald-500/15 text-emerald-300">this device</Badge>
                    )}
                  </p>
                  <p className="text-xs text-[#9AA89E]">
                    Last active {fmtDate(s.lastSeenAt)} · signed in {fmtDate(s.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="mt-4 h-10 hover:text-red-300"
          disabled={revokingOthers}
          onClick={() => void revokeOthers()}
        >
          {revokingOthers ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
          Log out all other sessions
        </Button>
      </section>

      {/* ── f) Recent security events (read-only) ── */}
      <section className="glass rounded-2xl p-5">
        <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">Recent Security Events</h3>
        {!events ? (
          <Skeleton className="mt-4 h-24 rounded-xl" />
        ) : events.length === 0 ? (
          <p className="mt-3 text-sm text-[#9AA89E]">No security events recorded yet.</p>
        ) : (
          <ul className="nice-scroll mt-4 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                <Badge variant="outline" className="border-[#E5B842]/30 bg-[#E5B842]/10 font-mono text-[10px] text-[#E5B842]">
                  {e.action}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[#C9D2CB]">{e.label ?? e.entity}</span>
                <span className="text-[#9AA89E]">{fmtDate(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
