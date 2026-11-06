// Constant-time secret comparison for transport guards and bearer-token
// checks. === leaks a timing oracle on the prefix bytes; timingSafeEqual
// with a length pre-check does not (length itself is not treated as secret).
import crypto from 'crypto'

export function secretsEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}
