'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — First-time security setup (stage ENROLL, T4-b §5.11).
// Restricted session: enroll the authenticator (QR + manual
// key), confirm with a live code, then the 10 recovery codes
// are shown EXACTLY ONCE. The backend keeps this session locked
// to enrollment endpoints, so finishing means signing in again
// with the new second factor (AdminApp shows the notice).
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AdminRecoveryCodes from '@/components/admin/AdminRecoveryCodes'
import { adminFetch } from '@/lib/admin-api'
import { playFx } from '@/lib/sound-fx'

interface AdminEnrollProps {
  email: string | null
  onDone: () => void
  onCancel: () => void
}

export default function AdminEnroll({ email, onDone, onCancel }: AdminEnrollProps) {
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function startEnrollment() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/2fa/enroll', { method: 'POST', body: JSON.stringify({}) })
      const data = (await res.json().catch(() => null)) as
        | { qrDataUrl?: string; secret?: string; error?: string }
        | null
      if (!res.ok || !data?.qrDataUrl || !data.secret) {
        throw new Error(data?.error ?? 'Could not start enrollment')
      }
      setQr(data.qrDataUrl)
      setSecret(data.secret)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start enrollment')
      playFx('error')
    } finally {
      setLoading(false)
    }
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !code.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/2fa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; recoveryCodes?: string[] | null; error?: string }
        | null
      if (!res.ok || !data?.ok) {
        setError(res.status === 401 ? 'Invalid code' : (data?.error ?? 'Confirmation failed — try again'))
        playFx('error')
        return
      }
      if (data.recoveryCodes && data.recoveryCodes.length > 0) {
        setRecoveryCodes(data.recoveryCodes)
      } else {
        onDone()
      }
    } catch {
      setError('Network error — try again')
      playFx('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass w-full max-w-md rounded-3xl p-8">
        <div className="text-center">
          <div
            className="mx-auto size-14 rounded-full shadow-[0_0_40px_rgba(229,184,66,0.45)]"
            style={{ background: 'radial-gradient(circle at 30% 30%, #fae8a7, #e5b842 50%, #8c6a1e)' }}
            aria-hidden="true"
          />
          <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Security Setup</h1>
          <p className="mt-1 text-xs text-[#9AA89E]">
            {email ? `${email} · ` : ''}Your account needs a second factor before full access.
          </p>
        </div>

        {/* Step 1 — enroll authenticator (QR + manual key) */}
        {!qr && !recoveryCodes && (
          <div className="mt-6 space-y-3 text-left">
            <p className="text-sm text-[#C9D2CB]">
              Install an authenticator app (Google Authenticator, 1Password, Authy…), then scan the QR code it shows
              you.
            </p>
            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <Button
              type="button"
              onClick={() => void startEnrollment()}
              disabled={loading}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Smartphone className="size-4" aria-hidden="true" />
              )}
              Set up authenticator app
            </Button>
            <button
              type="button"
              onClick={() => void onCancel()}
              className="block w-full text-center text-xs text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
            >
              Cancel and sign out
            </button>
          </div>
        )}

        {/* Step 2 — QR shown, confirm with a live code */}
        {qr && secret && !recoveryCodes && (
          <form onSubmit={confirmEnrollment} className="mt-6 space-y-3 text-left">
            <div className="flex flex-col items-center">
              {/* Data URL rendered by the backend (qrcode, 240px) */}
              <img
                src={qr}
                alt="QR code with the authenticator secret — scan it with your authenticator app"
                width={240}
                height={240}
                className="rounded-xl bg-white p-2"
              />
              <p className="mt-3 text-center text-[11px] text-[#9AA89E]">
                Can&apos;t scan? Enter this key manually:
              </p>
              <code className="mt-1 select-all break-all rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center font-mono text-xs text-[#F5F8F6]">
                {secret}
              </code>
            </div>

            <div>
              <Label htmlFor="enroll-code" className="sr-only">
                Authenticator code
              </Label>
              <Input
                id="enroll-code"
                inputMode="numeric"
                pattern="\d*"
                maxLength={10}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/[^\d]/g, ''))
                  setError(null)
                }}
                placeholder="6-digit code"
                autoComplete="one-time-code"
                autoFocus
                className="h-10 text-center font-mono text-lg tracking-[0.4em]"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || code.trim().length < 6}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Confirm and continue
            </Button>
          </form>
        )}

        {/* Step 3 — recovery codes, shown once */}
        {recoveryCodes && (
          <div className="mt-6">
            <h2 className="mb-3 text-center font-cinzel text-sm uppercase tracking-widest text-[#E5B842]">
              Save your recovery codes
            </h2>
            <AdminRecoveryCodes
              codes={recoveryCodes}
              doneLabel="I saved them — sign in"
              onDone={onDone}
            />
          </div>
        )}
      </div>
    </div>
  )
}
