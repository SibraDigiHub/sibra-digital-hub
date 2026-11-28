/** Server-rendered product fetches must not create anonymous visitor events.
 * The browser proxy overwrites this header to `0` on every browser request. */
export function shouldTrackProductView(headers: Pick<Headers, 'get'>): boolean {
  return headers.get('x-sdh-server-render') !== '1'
}
