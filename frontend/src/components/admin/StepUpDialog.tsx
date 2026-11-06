'use client'

// ═══════════════════════════════════════════════════════════
// Step-up re-authentication dialog — password re-entry gate for
// sensitive operations (refunds, deletions, export, security
// changes). Valid for 10 minutes server-side after success.
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminFetch } from '@/lib/admin-api'
import { playFx } from '@/lib/sound-fx'

interface StepUpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerified: (password: string) => void
  title?: string
  description?: string
}

export default function StepUpDialog({
  open,
  onOpenChange,
  onVerified,
  title = 'Confirm it\u2019s you',
  description = 'Re-enter your password to continue. This authorises sensitive actions for 10 minutes.',
}: StepUpDialogProps) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPassword('')
    setError(null)
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !password) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        playFx('chime')
        onVerified(password)
        reset()
        onOpenChange(false)
        return
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      setError(res.status === 403 ? 'Incorrect password' : data?.error ?? 'Verification failed')
      playFx('error')
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="border-white/15 bg-[#101512] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-cinzel text-[#E5B842]">
            <ShieldCheck className="size-5" aria-hidden="true" /> {title}
          </DialogTitle>
          <DialogDescription className="text-[#9AA89E]">{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Label htmlFor="stepup-password" className="sr-only">
              Admin password
            </Label>
            <Input
              id="stepup-password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              placeholder="Admin password"
              autoComplete="current-password"
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

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
              className="h-10"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !password} className="h-10 bg-[#E5B842] font-semibold text-black hover:bg-[#f0c95c]">
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
