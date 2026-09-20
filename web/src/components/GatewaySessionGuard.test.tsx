import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewaySessionGuard } from './GatewaySessionGuard'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('GatewaySessionGuard', () => {
    it('does not run when the optional deployment setting is absent', () => {
        const fetcher = vi.fn()
        vi.stubGlobal('fetch', fetcher)
        render(<GatewaySessionGuard />)
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('shows a manual reauthentication notice and clears it after renewal', async () => {
        vi.useFakeTimers()
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 401, headers: { 'X-Hapi-Gateway-Session': 'protected' } }))
            .mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'X-Hapi-Gateway-Session': 'protected' } }))
        vi.stubGlobal('fetch', fetcher)
        await act(async () => { render(<GatewaySessionGuard path="/hapi/.gateway/session" />) })
        expect(screen.getByRole('alert')).toHaveTextContent('Gateway sign-in expired')
        expect(screen.getByRole('button', { name: 'Sign in again' })).toBeVisible()
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
        expect(screen.queryByRole('alert')).toBeNull()
    })
})
