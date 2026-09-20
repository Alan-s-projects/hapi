import { describe, expect, it } from 'bun:test'
import { redactRequestLog } from './requestLog'

describe('request log query redaction', () => {
    it.each([
        '<-- GET /api/events?token=secret&all=true',
        '<-- GET /api/auth?%74oken=secret',
        '<-- GET /auth?rd=https%3A%2F%2Fexample.com%2F%3Ftoken%3Dsecret',
        '<-- GET /api/file?path=private-file&access_token=secret'
    ])('removes the complete query without changing the request', (line) => {
        expect(redactRequestLog(line)).toBe(line.slice(0, line.indexOf('?')) + '?[REDACTED]')
    })

    it('preserves paths, status and timing', () => {
        expect(redactRequestLog('--> GET /api/events?token=secret 200 4ms')).toBe('--> GET /api/events?[REDACTED] 200 4ms')
        expect(redactRequestLog('--> GET /health 200 0ms')).toBe('--> GET /health 200 0ms')
    })
})
