import { describe, expect, it } from 'bun:test'
import { hubUrl, normalizeBasePath, normalizeHubUrl, socketEndpoint, stripBasePath } from './url'

describe('deployment URLs', () => {
    it('normalizes root and nested deployment prefixes', () => {
        expect(normalizeBasePath('/')).toBe('')
        expect(normalizeBasePath('/hapi/')).toBe('/hapi')
        expect(normalizeBasePath('/tools/hapi')).toBe('/tools/hapi')
        for (const bad of ['hapi', '//', '//host', '/hapi//', '/hapi//x', '/hapi/../x', '/hapi%2fx', '/hapi?x', '/hapi\\x']) {
            expect(() => normalizeBasePath(bad)).toThrow()
        }
    })
    it('keeps the hub path and rejects secret-bearing/ambiguous overrides', () => {
        expect(normalizeHubUrl('https://example.com/hapi/')).toBe('https://example.com/hapi')
        for (const bad of ['ftp://example.com', 'https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#x']) {
            expect(() => normalizeHubUrl(bad)).toThrow()
        }
    })
    it('joins REST and SSE URLs without resetting to the origin root', () => {
        expect(hubUrl('https://example.com/hapi/', '/api/auth')).toBe('https://example.com/hapi/api/auth')
        expect(hubUrl('https://example.com/hapi', '/api/events?token=test')).toBe('https://example.com/hapi/api/events?token=test')
        expect(hubUrl('https://example.com', '/api/auth')).toBe('https://example.com/api/auth')
        expect(hubUrl('', '/api/auth')).toBe('/api/auth')
        expect(() => hubUrl('https://example.com', '//evil.example/api')).toThrow()
    })
    it('separates the Engine.IO HTTP path from the logical namespace', () => {
        expect(socketEndpoint('https://example.com/hapi')).toEqual({ origin: 'https://example.com', path: '/hapi/socket.io/' })
        expect(socketEndpoint('https://example.com/')).toEqual({ origin: 'https://example.com', path: '/socket.io/' })
    })
    it('matches only a full prefix boundary', () => {
        expect(stripBasePath('/hapi/api/auth', '/hapi')).toBe('/api/auth')
        for (const other of ['/hapix/api', '/api/auth', '/hapi%2fapi', '/%68api/api']) {
            expect(stripBasePath(other, '/hapi')).toBeNull()
        }
    })
})
