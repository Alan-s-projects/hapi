import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkGatewaySession } from './gatewaySession'

afterEach(() => vi.unstubAllGlobals())

describe('optional gateway session check', () => {
    it.each([200, 404, 401])('does not mistake a direct hub response (%s) for gateway expiry', async (status) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
        expect(await checkGatewaySession('/hapi/.gateway/session')).toBe('disabled')
    })

    it.each([[204, 'active'], [401, 'expired'], [403, 'expired'], [503, 'unavailable']] as const)(
        'classifies marked gateway status %s as %s', async (status, expected) => {
            const fetcher = vi.fn().mockResolvedValue(new Response(null, {
                status, headers: { 'X-Hapi-Gateway-Session': 'protected' }
            }))
            vi.stubGlobal('fetch', fetcher)
            expect(await checkGatewaySession('/hapi/.gateway/session')).toBe(expected)
            expect(fetcher).toHaveBeenCalledOnce()
            expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'manual' })
            expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
        }
    )

    it('does not treat network failure as logout or retry a write', async () => {
        const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
        vi.stubGlobal('fetch', fetcher)
        expect(await checkGatewaySession('/hapi/.gateway/session')).toBe('unavailable')
        expect(fetcher).toHaveBeenCalledOnce()
    })
})
