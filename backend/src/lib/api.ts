// Shared HTTP building blocks for route handlers: typed errors, JSON replies,
// Zod-based parsing, and one error funnel so every failure answers the same way.
// T3 speed rules live here too: Server-Timing on every response, a fail-safe
// `Cache-Control: no-store` default (public GETs opt INTO caching explicitly),
// a 64 KB JSON body cap and slow-request logging.
import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { logger } from '@/lib/logger'

// ── #err-logging-blind: request correlation + redacted diagnostics ──
// Every response carries `x-request-id` (echoing the id the frontend
// proxy generated, so one browser request is traceable end-to-end);
// unhandled-error logs carry the message, route, requestId and a
// REDACTED stack — no PII (emails) and no secrets ever reach the logs.

/** Secret-shaped assignments (`token=…`, "authorization": "…") in log text. */
const SECRET_SHAPED =
  /(authorization|token|secret|password|api[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi
/** Bearer credentials (`Bearer <value>` — the value is the secret, not the label). */
const BEARER_SHAPED = /bearer\s+[^\s"',}]+/gi
/** Email-shaped strings are PII — masked like the rest of the logger. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const MAX_STACK_LINES = 8

/** Redact secrets + PII from any free-form text destined for the logs. */
export function redactLogText(text: string): string {
  return text
    .replace(BEARER_SHAPED, 'bearer [redacted]')
    .replace(SECRET_SHAPED, '$1$2[redacted]')
    .replace(EMAIL_SHAPED, '[redacted-email]')
}

/** First N stack lines, secrets and PII scrubbed. */
function redactedStack(e: unknown): string | undefined {
  if (!(e instanceof Error) || !e.stack) return undefined
  return redactLogText(e.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n'))
}

/**
 * The exact fields an unhandled-error log line carries: redacted message,
 * method+route, the correlation id and the redacted stack. Exported pure so
 * the shape stays regression-tested (FINDINGS #err-logging-blind used to be
 * `{"err":{},"route":""}` — no detail, no route, no request id).
 */
export function errorLogFields(e: unknown, arg0: unknown, requestId: string): Record<string, unknown> {
  return {
    err: { message: e instanceof Error ? redactLogText(e.message) : redactLogText(String(e)) },
    route: routeFor(arg0),
    requestId,
    stack: redactedStack(e),
  }
}

/**
 * The correlation id for a request: the frontend proxy already generates
 * `x-request-id` for every proxied call — echo it verbatim (bounded to
 * sane id-shaped characters) so support can grep both sides; generate a
 * fresh one for direct calls.
 * (Duck-typed on purpose: the Next 16.4 runtime does NOT guarantee an
 * `instanceof NextRequest` here — the old instanceof check silently
 * failed, which is exactly how the empty `route:""` logs happened.)
 */
function asRequestLike(arg0: unknown): Request | null {
  if (arg0 && typeof arg0 === 'object' && typeof (arg0 as Request).headers?.get === 'function') {
    return arg0 as Request
  }
  return null
}

function requestIdFor(arg0: unknown): string {
  const req = asRequestLike(arg0)
  const incoming = req?.headers.get('x-request-id')?.trim()
  if (incoming && incoming.length >= 8 && incoming.length <= 128 && /^[\w.-]+$/.test(incoming)) {
    return incoming
  }
  return randomUUID()
}

function routeFor(arg0: unknown): string {
  const req = asRequestLike(arg0)
  if (!req) return 'unknown'
  try {
    return `${req.method} ${new URL(req.url).pathname}`
  } catch {
    return req.method || 'unknown'
  }
}

/** Stable error type — services throw it, handlers map it to responses. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'api_error',
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const unauthorized = (msg = 'Unauthorized — admin session required') => new ApiError(401, msg, 'unauthorized')
export const forbidden = (msg = 'Forbidden') => new ApiError(403, msg, 'forbidden')
export const badRequest = (msg: string) => new ApiError(400, msg, 'bad_request')
export const notFound = (msg = 'Not found') => new ApiError(404, msg, 'not_found')
export const conflict = (msg: string) => new ApiError(409, msg, 'conflict')
export const payloadTooLarge = (msg = 'Request body too large') => new ApiError(413, msg, 'payload_too_large')

/**
 * T7 (§8.2): uniform rate-limit response — generic JSON body (no internals,
 * no bucket details) + `Retry-After` in seconds for well-behaved clients.
 */
export function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests, try again shortly.' },
    { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSec))) } },
  )
}

/** JSON bodies are capped — no base64 files, no unbounded uploads. */
export const MAX_JSON_BYTES = 64 * 1024

/** Public GET cache policy (T3.2): 60 s edge cache + 5 min stale-while-revalidate. */
export const PUBLIC_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/**
 * Wraps a route handler: ApiError → its status/message, everything else → 500
 * with a generic body (no stack traces, no internals) and a server-side log.
 *
 * Also guarantees, on every response:
 *  - `Cache-Control: no-store` unless the handler set a policy itself (fail-safe
 *    default: everything is private unless a public GET explicitly opts in);
 *  - `Server-Timing: total;dur=…` (observability, no secrets);
 *  - a warn log for requests slower than 300 ms (no personal data).
 */
export function asHandler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const startedAt = Date.now()
    const requestId = requestIdFor(args[0])
    try {
      const res = await fn(...args)
      return withTiming(res, startedAt, args[0], requestId)
    } catch (e) {
      let res: NextResponse
      if (e instanceof ApiError) {
        // `code` is included only for non-default codes (dual-payment states:
        // REPEAT_PURCHASE, NO_USD_PRICE, …) — legacy error bodies stay byte-identical.
        const body = e.code === 'api_error' ? { error: e.message } : { error: e.message, code: e.code }
        res = NextResponse.json(body, { status: e.status })
      } else if (e instanceof ZodError) {
        res = NextResponse.json({ error: firstIssue(e) }, { status: 400 })
      } else {
        logger.error(errorLogFields(e, args[0], requestId), 'unhandled route error')
        res = NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
      }
      return withTiming(res, startedAt, args[0], requestId)
    }
  }
}

/** Apply the no-store default + Server-Timing + x-request-id + slow-request log. */
function withTiming(res: Response, startedAt: number, arg0: unknown, requestId: string): Response {
  const dur = Date.now() - startedAt
  if (!res.headers.get('cache-control')) res.headers.set('cache-control', 'no-store')
  if (!res.headers.get('server-timing')) res.headers.set('server-timing', `total;dur=${dur}`)
  if (!res.headers.get('x-request-id')) res.headers.set('x-request-id', requestId)
  if (dur > 300) {
    logger.warn({ route: routeFor(arg0), requestId, ms: dur }, 'slow request')
  }
  return res
}

/**
 * Public-GET JSON with an ETag: answers `304 Not Modified` when the client
 * already holds the body, otherwise `200` with the T3 cache policy.
 * (Volatile headers like Set-Cookie are the caller's concern — responses that
 * set cookies are never edge-cached by the CDN anyway.)
 */
export function cachedJson(
  req: NextRequest,
  data: unknown,
  opts: { varyCookie?: boolean } = {},
): NextResponse {
  const body = JSON.stringify(data)
  const etag = `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    etag,
    'cache-control': PUBLIC_CACHE_CONTROL,
  }
  if (opts.varyCookie) headers.vary = 'Cookie'

  const inm = req.headers.get('if-none-match')
  if (inm && inm.split(',').map((v) => v.trim()).some((v) => v === etag || v === `W/${etag}` || v === `W/"${etag.slice(3)}"`)) {
    return new NextResponse(null, { status: 304, headers })
  }
  return new NextResponse(body, { status: 200, headers })
}

function firstIssue(e: ZodError): string {
  const i = e.issues[0]
  return i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Invalid input'
}

/** Reject oversized bodies early (413) — protects the parser and the DB. */
function assertBodySize(req: NextRequest) {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(len) && len > MAX_JSON_BYTES) {
    throw payloadTooLarge()
  }
}

/** Parse a JSON body against a Zod schema (schema.parse output type is authoritative). */
export async function parseBody<T>(req: NextRequest, schema: { parse: (data: unknown) => T }): Promise<T> {
  assertBodySize(req)
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
  return schema.parse(raw)
}

/** Raw JSON parse with the same 64 KB cap (routes that read bodies directly). */
export async function readJsonCapped(req: NextRequest): Promise<unknown> {
  assertBodySize(req)
  try {
    return await req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
}

/** Parse query params against a Zod schema. */
export function parseQuery<T>(req: NextRequest, schema: { parse: (data: unknown) => T }): T {
  const obj: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v
  })
  return schema.parse(obj)
}

/** Coerce unknown → trimmed string (legacy bodies are loosely typed). */
export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
