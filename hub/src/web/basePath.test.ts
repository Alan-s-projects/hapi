import { describe, expect, it } from 'bun:test'
import { routeBasePath } from './basePath'

describe('HTTP deployment boundary', () => {
    it('preserves the root deployment request identity', () => {
        const request = new Request('http://localhost/api/auth')
        const result = routeBasePath(request, '')
        expect(result instanceof Response).toBe(false)
        if (!(result instanceof Response)) expect(result.request).toBe(request)
    })
    it('preserves method, body, authorization and query after prefix routing', async () => {
        const request = new Request('http://localhost/hapi/api/auth?test=1', {
            method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: 'test-only' }),
        })
        const result = routeBasePath(request, '/hapi')
        if (result instanceof Response) throw new Error('Unexpected response')
        expect(result.url.pathname).toBe('/api/auth')
        expect(result.url.search).toBe('?test=1')
        expect(result.request.method).toBe('POST')
        expect(result.request.headers.get('authorization')).toBe('Bearer test')
        expect(await result.request.json()).toEqual({ accessToken: 'test-only' })
    })
    it('does not expose root APIs or prefix lookalikes', () => {
        for (const path of ['/api/auth', '/socket.io/', '/hapix/api/auth', '/hapi%2fapi/auth', '/%68api/api/auth']) {
            const result = routeBasePath(new Request(`http://localhost${path}`), '/hapi')
            expect(result instanceof Response && result.status).toBe(404)
        }
    })
    it('redirects the bare prefix using a relative URL', () => {
        const result = routeBasePath(new Request('http://untrusted-host/hapi?x=1'), '/hapi') as Response
        expect(result.status).toBe(308)
        expect(result.headers.get('location')).toBe('/hapi/?x=1')
    })
})
