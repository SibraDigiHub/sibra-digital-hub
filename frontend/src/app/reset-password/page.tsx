'use client'

// ═══════════════════════════════════════════════════════════
// Standalone password-reset page (OUTSIDE the hash-router SPA).
//
// Link shape: /reset-password#token=…
// • The token travels in the URL fragment — never a query string,
//   never a referrer, never a server log.
// • This page reads the fragment, immediately strips it from the
//   address bar (history.replaceState) and keeps it in memory
//   only; the reset POST carries it in the JSON body.
// • A valid second factor (authenticator code or recovery code)
//   is required — a stolen mailbox alone cannot take over.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // Token starts null on BOTH server and client render (no hydration
  // mismatch), then the fragment is read right after hydration.
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      await Promise.resolve()
      // Read token from the fragment…
      const match = window.location.hash.match(/token=([^&]+)/)
      if (match) setToken(decodeURIComponent(match[1]))
      // …and immediately scrub it from the address bar (external system).
      if (window.location.hash.includes('token=')) {
        window.history.replaceState(null, '', '/reset-password')
      }
    })()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !token) return
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const payload: Record<string, string> = { token, newPassword: password }
      if (recoveryMode && code.trim()) payload.recoveryCode = code.trim()
      else if (code.trim()) payload.code = code.trim()

      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (res.ok) {
        setDone(true)
        return
      }
      setError(data?.error ?? 'Invalid or expired reset link')
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07090B] p-4 text-[#F5F8F6]">
      <div className="glass w-full max-w-sm rounded-3xl p-8 text-center">
        <div
          className="mx-auto size-14 rounded-full shadow-[0_0_40px_rgba(229,184,66,0.45)]"
          style={{ background: 'radial-gradient(circle at 30% 30%, #fae8a7, #e5b842 50%, #8c6a1e)' }}
          aria-hidden="true"
        />
        {done ? (
          <>
            <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Password updated</h1>
            <p className="mt-2 text-sm text-[#9AA89E]">
              All sessions were signed out. Sign in with your new password — you will also need your second factor.
            </p>
            <a
              href="/#/admin"
              className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md bg-[#E5B842] font-semibold text-black transition-colors hover:bg-[#f0c95c]"
            >
              Go to admin sign-in
            </a>
          </>
        ) : !token ? (
          <>
            <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Reset link problem</h1>
            <p className="mt-2 text-sm text-[#9AA89E]">
              This page needs a reset token. Open the reset link from your email again, or request a new one from the
              admin sign-in page.
            </p>
            <a
              href="/#/admin"
              className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md border border-white/20 text-sm transition-colors hover:bg-white/5"
            >
              Back to admin sign-in
            </a>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Choose a new password</h1>
            <form onSubmit={handleSubmit} className="mt-6 space-y-3 text-left">
              <div className="relative">
                <Label htmlFor="rp-password" className="sr-only">
                  New password
                </Label>
                <Input
                  id="rp-password"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  placeholder="New password (≥12 characters)"
                  autoComplete="new-password"
                  autoFocus
                  className="h-10 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-[#9AA89E] hover:text-[#F5F8F6]"
                >
                  {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
              <div>
                <Label htmlFor="rp-confirm" className="sr-only">
                  Confirm new password
                </Label>
                <Input
                  id="rp-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  className="h-10"
                />
              </div>
              <div>
                <Label htmlFor="rp-code" className="sr-only">
                  Second factor
                </Label>
                <Input
                  id="rp-code"
                  value={code}
                  onChange={(e) => setCode(recoveryMode ? e.target.value.toUpperCase() : e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  inputMode={recoveryMode ? 'text' : 'numeric'}
                  placeholder={recoveryMode ? 'Recovery code (XXXX-XXXX-XXXX-XXXX)' : 'Authenticator code (123456)'}
                  autoComplete="one-time-code"
                  className="h-10 text-center font-mono tracking-[0.2em]"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setRecoveryMode((m) => !m)
                  setCode('')
                }}
                className="mx-auto flex h-8 w-full items-center justify-center text-xs text-[#9AA89E] hover:text-[#F5F8F6]"
              >
                {recoveryMode ? 'Use authenticator code instead' : 'Use a recovery code instead'}
              </button>

              {error && (
                <p className="text-sm text-red-400" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading || password.length < 12 || password !== confirm}
                className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
              >
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
                Reset password
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-[#9AA89E]">
                Finishing the reset signs out every device. If you lost your authenticator <em>and</em> recovery codes,
                use <span className="font-mono">npm run admin:reset-2fa</span> on the server (see docs/ADMIN_RECOVERY.md).
              </p>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-400/80">
                <CheckCircle2 className="size-3.5" aria-hidden="true" /> Reset token removed from the address bar
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
