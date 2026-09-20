import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SSEManager } from '../../sse/sseManager'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
import type { WebAppEnv } from '../middleware/auth'
import { createEventsRoutes, sseMaxConnectionMs } from './events'

const original = process.env.HAPI_SSE_MAX_CONNECTION_SECONDS
afterEach(() => {
    if (original === undefined) delete process.env.HAPI_SSE_MAX_CONNECTION_SECONDS
    else process.env.HAPI_SSE_MAX_CONNECTION_SECONDS = original
})

describe('bounded gateway SSE connections', () => {
    it('is optional and rejects invalid lifetime configuration', () => {
        expect(sseMaxConnectionMs(undefined)).toBe(0)
        expect(sseMaxConnectionMs('0')).toBe(0)
        expect(sseMaxConnectionMs('60')).toBe(60_000)
        for (const value of ['-1', '1.5', 'NaN', 'Infinity', '3601']) {
            expect(() => sseMaxConnectionMs(value)).toThrow()
        }
    })

    it('closes a stream on schedule and unsubscribes it without discarding replay history', async () => {
        process.env.HAPI_SSE_MAX_CONNECTION_SECONDS = '1'
        const manager = new SSEManager(0, new VisibilityTracker())
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
        app.route('/', createEventsRoutes(() => manager, () => null, () => null))
        const started = Date.now()
        const response = await app.request('/events?all=true')
        const content = await response.text()
        const first = JSON.parse(content.split('\n').find(line => line.startsWith('data:'))!.slice(5))
        expect(first.type).toBe('connection-changed')
        expect(manager.hasSubscription(first.data.subscriptionId)).toBe(false)
        expect(Date.now() - started).toBeGreaterThanOrEqual(900)
        expect(Date.now() - started).toBeLessThan(4000)
        manager.stop()
    })
})
