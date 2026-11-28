import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '../proxy'

describe('API proxy analytics-origin header', () => {
  test('overwrites a browser-supplied server-render marker', () => {
    const request = new NextRequest('https://shop.example/api/products?slug=sample', {
      headers: { 'x-sdh-server-render': '1' },
    })
    const response = proxy(request)

    expect(response.headers.get('x-middleware-request-x-sdh-server-render')).toBe('0')
  })
})
