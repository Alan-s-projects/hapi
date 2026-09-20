import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import { normalizeServerUrl } from '@/hooks/useServerUrl'
import { buildEventsUrl } from '@/hooks/useSSE'

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
})

describe('prefixed browser deployment', () => {
    it('preserves the selected hub path rather than only its origin', () => {
        expect(normalizeServerUrl('https://example.com/hapi/')).toEqual({ ok: true, value: 'https://example.com/hapi' })
    })
    it('prefixes API authentication and protected requests', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
        vi.stubGlobal('fetch', fetchMock)
        const api = new ApiClient('test-jwt', { baseUrl: 'https://example.com/hapi' })
        await api.authenticate({ accessToken: 'test-only' })
        expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/hapi/api/auth')
        fetchMock.mockResolvedValueOnce(new Response('{"sessions":[]}'))
        await api.getSessions()
        expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/hapi/api/sessions')
    })
    it('prefixes the event stream including reconnect state', () => {
        const url = new URL(buildEventsUrl('https://example.com/hapi', 'test-token', { all: true }, 'visible', 'event-1'))
        expect(url.pathname).toBe('/hapi/api/events')
        expect(url.searchParams.get('lastEventId')).toBe('event-1')
    })
    it('maps UI paths once, and lets route comparisons use canonical paths', async () => {
        vi.stubEnv('BASE_URL', '/hapi/')
        vi.resetModules()
        const { appPath, appPathname } = await import('./basePath')
        expect(appPath('/sessions/one')).toBe('/hapi/sessions/one')
        expect(appPath('/hapi/sessions/one')).toBe('/hapi/sessions/one')
        expect(appPathname('/hapi/sessions/one')).toBe('/sessions/one')
        expect(appPathname('/sessions/one')).toBe('/sessions/one')
    })
})
