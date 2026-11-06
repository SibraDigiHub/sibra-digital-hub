'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Reset password view (T4-b §5.6/§5.11). Lives on the
// hash route `#/admin-reset?token=…` (the exact link shape the
// backend builds from PUBLIC_WEB_URL — the token is in the URL
// FRAGMENT, so it never reaches any server or referrer).
// On mount the token is moved out of the address bar with
// history.replaceState immediately, then sent only in the POST
// body together with the new password and a second factor.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { adminFetch } from '@/lib/admin-api'
import { playFx } from '@/lib/sound-fx'

function readTokenFromHash(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith('#/admin-reset')) return null
  const query = hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('token')
}

/** Lightweight client hint — the backend enforces the real policy. */
function strengthHint(pw: string): { label: string; tone: string } {
  if (!pw) return { label: '', tone: 'text-[#9AA89E]' }
  if (pw.length < 12) return { label: `Too short — ${12 - pw.length} more character${12 - pw.length === 1 ? '' : 's'} (min 12)`, tone: 'text-red-400' }
  let score = 1
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 2) return { label: 'Acceptable — add upper/lower case, digits or symbols to strengthen it', tone: 'text-amber-300' }
  if (score === 3) return { label: 'Good password', tone: 'text-emerald-300' }
  return { label: 'Strong password', tone: 'text-emerald-300' }
}

export default function AdminResetPassword() {
  const navigate = useAppStore((s) => s.navigate)
  const { toast } = useToast()
  // Read the token in a one-shot lazy initializer (client-only component).
  const [token, setToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readTokenFromHash(),
  )
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  function goToSignIn() {
    navigate('admin')
  }

  useEffect(() => {
    // Strip the secret from the address bar (external-system update in an
    // effect, never during render). The token lives in the URL FRAGMENT so
    // it was never sent to any server — no reason to keep it visible.
    if (token) {
      try {
        window.history.replaceState(null, '', `${window.location.pathname}#/admin-reset`)
      } catch {
        /* ignore */
      }
    }
    // SPA re-entry with a fresh link (hash change, no reload) → re-read.
    const onHash = () => setToken(readTokenFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !token || !password) return
    setLoading(true)
    setError(null)
    try {
      const secondFactor = mode === 'recovery' ? { recoveryCode: code.trim() } : { totp: code.trim() }
      const res = await adminFetch('/api/admin/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password, secondFactor }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        setDone(true)
        toast({ title: 'Password changed — sign in' })
        return
      }
      setError(data?.error ?? 'Reset failed — the link may have expired')
      playFx('error')
    } catch {
      setError('Network error — try again')
      playFx('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07090B] p-4 text-[#F5F8F6]">
      <div className="glass w-full max-w-sm rounded-3xl p-8">
        <div className="text-center">
          <div
            className="mx-auto size-14 rounded-full shadow-[0_0_40px_rgba(229,184,66,0.45)]"
            style={{ background: 'radial-gradient(circle at 30% 30%, #fae8a7, #e5b842 50%, #8c6a1e)' }}
            aria-hidden="true"
          />
          <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Reset Password</h1>
          <p className="mt-1 text-xs text-[#9AA89E]">Sibra Digital Hub · Admin recovery</p>
        </div>

        {!token ? (
          <div className="mt-6 space-y-4 text-left">
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
              This reset link is incomplete. Request a fresh one from the sign-in screen — links expire after 30
              minutes.
            </p>
            <Button
              type="button"
              onClick={goToSignIn}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Go to sign in
            </Button>
          </div>
        ) : done ? (
          <div className="mt-6 space-y-4 text-left">
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300" role="status">
              Password changed — all previous sessions were signed out. You can sign in with your new password and
              second factor now.
            </p>
            <Button
              type="button"
              onClick={goToSignIn}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              <KeyRound className="size-4" aria-hidden="true" />
              Sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3 text-left">
            <div className="relative">
              <Label htmlFor="reset-password" className="sr-only">
                New password
              </Label>
              <Input
                id="reset-password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                placeholder="New password"
                autoComplete="new-password"
                autoFocus
                required
                minLength={12}
                className="h-10 pr-11"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
              >
                {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            {password && (
              <p className={`text-xs ${strengthHint(password).tone}`} aria-live="polite">
                {strengthHint(password).label}
              </p>
            )}

            <div>
              <Label htmlFor="reset-factor" className="sr-only">
                Second factor
              </Label>
              <Input
                id="reset-factor"
                value={code}
                onChange={(e) => {
                  setCode(mode === 'totp' ? e.target.value.replace(/[^\d]/g, '') : e.target.value)
                  setError(null)
                }}
                inputMode={mode === 'totp' ? 'numeric' : 'text'}
                maxLength={mode === 'totp' ? 10 : 32}
                placeholder={mode === 'totp' ? 'Authenticator code' : 'Recovery code'}
                autoComplete={mode === 'totp' ? 'one-time-code' : 'off'}
                required
                className="h-10 text-center font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={() => {
                  setMode((m) => (m === 'totp' ? 'recovery' : 'totp'))
                  setCode('')
                }}
                className="mt-1.5 text-xs text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
              >
                {mode === 'totp' ? 'Use a recovery code instead' : 'Use authenticator code instead'}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !password || !code.trim()}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Change password
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
