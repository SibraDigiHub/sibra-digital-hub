'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — Login gate (T4-b): email + password, show/hide
// toggle, generic errors, and the forgot-password flow.
// Centered glass card, gold orb logo — same look as before.
// Stage handling: FULL → dashboard, PENDING_2FA/ENROLL → the
// matching step screen (owned by AdminApp).
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, LogIn, MailQuestion, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminFetch } from '@/lib/admin-api'
import { playFx } from '@/lib/sound-fx'

export const LOGIN_STAGE_ERROR = 'Invalid email or password'

interface AdminLoginProps {
  onSuccess: () => void
  onStage: (stage: 'PENDING_2FA' | 'ENROLL') => void
  notice?: string | null
}

export default function AdminLogin({ onSuccess, onStage, notice }: AdminLoginProps) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Forgot-password state — the answer is ALWAYS the same, whether or
  // not the email exists (no enumeration, per backend §5.6).
  const [forgotSent, setForgotSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !email.trim() || !password) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; stage?: string; error?: string } | null
      if (res.ok && data?.ok) {
        if (data.stage === 'PENDING_2FA' || data.stage === 'ENROLL') {
          onStage(data.stage)
        } else {
          onSuccess()
        }
        return
      }
      if (res.status === 401) {
        setError(LOGIN_STAGE_ERROR)
      } else {
        setError(data?.error ?? 'Login failed — try again')
      }
      playFx('error')
    } catch {
      setError('Network error — try again')
      playFx('error')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = (await res.json().catch(() => null)) as { message?: string } | null
      setForgotSent(true)
      void data
    } catch {
      // Same neutral answer even when the request itself fails — never leak.
      setForgotSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass w-full max-w-sm rounded-3xl p-8 text-center">
        <div
          className="mx-auto size-14 rounded-full shadow-[0_0_40px_rgba(229,184,66,0.45)]"
          style={{ background: 'radial-gradient(circle at 30% 30%, #fae8a7, #e5b842 50%, #8c6a1e)' }}
          aria-hidden="true"
        />
        <h1 className="mt-4 font-cinzel text-2xl text-[#E5B842]">Admin Access</h1>
        <p className="mt-1 text-xs text-[#9AA89E]">Sibra Digital Hub · Control Room</p>

        {notice && (
          <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-sm text-emerald-300" role="status">
            {notice}
          </p>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3 text-left">
            <div>
              <Label htmlFor="admin-email" className="sr-only">
                Email
              </Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                placeholder="admin@example.com"
                autoComplete="username"
                autoFocus
                required
                className="h-10"
              />
            </div>
            <div className="relative">
              <Label htmlFor="admin-password" className="sr-only">
                Password
              </Label>
              <Input
                id="admin-password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                placeholder="Password"
                autoComplete="current-password"
                required
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

            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !email.trim() || !password}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="size-4" aria-hidden="true" />
              )}
              Sign in
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode('forgot')
                setError(null)
                setForgotSent(false)
              }}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
            >
              <MailQuestion className="size-3.5" aria-hidden="true" />
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="mt-6 space-y-3 text-left">
            {forgotSent ? (
              <p
                className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-[#C9D2CB]"
                role="status"
              >
                If this email is registered, a reset link has been sent. Check your inbox — the link also asks for a
                second factor.
              </p>
            ) : (
              <div>
                <Label htmlFor="forgot-email" className="sr-only">
                  Email
                </Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                  placeholder="admin@example.com"
                  autoComplete="username"
                  autoFocus
                  required
                  className="h-10"
                />
              </div>
            )}

            <Button
              type={forgotSent ? 'button' : 'submit'}
              onClick={forgotSent ? () => setMode('login') : undefined}
              disabled={loading || (!forgotSent && !email.trim())}
              className="h-10 w-full bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="size-4" aria-hidden="true" />
              )}
              {forgotSent ? 'Back to sign in' : 'Send reset link'}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode('login')
                setError(null)
              }}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-[#9AA89E] transition-colors hover:text-[#F5F8F6]"
            >
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
