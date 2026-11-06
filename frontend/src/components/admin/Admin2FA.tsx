'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Second-factor step (T4-b §5.11). Completes a
// PENDING_2FA login with an authenticator code, a recovery
// code, or a passkey (WebAuthn). Success ⇒ brand-new FULL
// session (the backend rotates the id), AdminApp re-probes.
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { Fingerprint, KeyRound, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminFetch } from '@/lib/admin-api'
import { startAuthentication } from '@simplewebauthn/browser'
import { playFx } from '@/lib/sound-fx'

interface Admin2FAProps {
  email: string | null
  onVerified: () => void
  onCancel: () => void
}

type FactorMode = 'totp' | 'recovery'

export default function Admin2FA({ email, onVerified, onCancel }: Admin2FAProps) {
  const [mode, setMode] = useState<FactorMode>('totp')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  async function verifySecondFactor(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !code.trim()) return
    setLoading(true)
    setError(null)
    try {
      const body = mode === 'recovery' ? { recoveryCode: code.trim() } : { code: code.trim() }
      const res = await adminFetch('/api/admin/login/2fa', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        onVerified()
        return
      }
      setError(res.status === 401 ? 'Invalid code' : (data?.error ?? 'Verification failed — try again'))
      playFx('error')
    } catch {
      setError('Network error — try again')
      playFx('error')
    } finally {
      setLoading(false)
    }
  }

  async function signInWithPasskey() {
    if (passkeyBusy || !email) return
    setPasskeyBusy(true)
    setError(null)
    try {
      if (typeof navigator === 'undefined' || !navigator.credentials || !window.isSecureContext) {
        throw new Error('unavailable')
      }
      const optionsRes = await adminFetch('/api/admin/login/passkey/options', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      const optionsData = (await optionsRes.json().catch(() => null)) as {
        options?: Parameters<typeof startAuthentication>[0]['optionsJSON']
        error?: string
      } | null
      if (!optionsRes.ok || !optionsData?.options) throw new Error(optionsData?.error ?? 'Could not start passkey sign-in')

      const assertion = await startAuthentication({ optionsJSON: optionsData.options })
      const verifyRes = await adminFetch('/api/admin/login/passkey/verify', {
        method: 'POST',
        body: JSON.stringify({ email, response: assertion }),
      })
      const verifyData = (await verifyRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (verifyRes.ok && verifyData?.ok) {
        onVerified()
        return
      }
      setError(verifyRes.status === 401 ? 'Invalid code' : (verifyData?.error ?? 'Passkey sign-in failed'))
      playFx('error')
    } catch (err) {
      const unavailable =
        err instanceof Error &&
        (err.message === 'unavailable' || err.name === 'NotAllowedError' || err.name === 'InvalidStateError')
      setError(
        unavailable
          ? 'Passkeys are not available on this device — use your authenticator app or a recovery code'
          : 'Passkey sign-in failed — try your authenticator app or a recovery code',
      )
      playFx('error')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function cancelPending() {
    // Log out the pending session (idempotent on the backend) and go back.
    try {
      await adminFetch('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) })
    } catch {
      /* ignore — the pending session dies within 5 minutes anyway */
    }
    onCancel()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass w-full max-w-sm rounded-3xl p-8 text-center">
        <div
          className="mx-auto size-14 rounded-full shadow-[0_0_40px_rgba(229,184,66,0.45)]"
          style={{ background: 'radial-gradient(circle at 30% 30%, #fae8a7, #e5b842 50%, #8c6a1e)' }}
          aria-hidden="true"
        />
        <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Two-Step Verification</h1>
        <p className="mt-1 text-xs text-[#9AA89E]">
          {email ? `Signed in as ${email}` : 'Enter the code from your authenticator app'}
        </p>

        <form onSubmit={verifySecondFactor} className="mt-6 space-y-3 text-left">
          {mode === 'totp' ? (
            <div>
              <Label htmlFor="totp-code" className="sr-only">
                Authenticator code
              </Label>
              <Input
                id="totp-code"
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
                aria-describedby="totp-hint"
                className="h-10 text-center font-mono text-lg tracking-[0.4em]"
              />
              <p id="totp-hint" className="mt-1.5 text-center text-[11px] text-[#9AA89E]">
                Open your authenticator app and enter the current code.
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="recovery-code" className="sr-only">
                Recovery code
              </Label>
              <Input
                id="recovery-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setError(null)
                }}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                autoFocus
                className="h-10 text-center font-mono uppercase tracking-wider"
              />
              <p className="mt-1.5 text-center text-[11px] text-[#9AA89E]">
                Each recovery code works once — dashes are optional.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || !code.trim()}
            className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4" aria-hidden="true" />
            )}
            Verify
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={passkeyBusy}
            onClick={() => void signInWithPasskey()}
            className="h-10 w-full"
          >
            {passkeyBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Fingerprint className="size-4" aria-hidden="true" />
            )}
            Use a passkey
          </Button>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'totp' ? 'recovery' : 'totp'))
                setCode('')
                setError(null)
              }}
              className="flex items-center gap-1.5 text-xs text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
            >
              <KeyRound className="size-3.5" aria-hidden="true" />
              {mode === 'totp' ? 'Use a recovery code' : 'Use authenticator code'}
            </button>
            <button
              type="button"
              onClick={() => void cancelPending()}
              className="text-xs text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
