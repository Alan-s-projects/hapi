export type GatewaySessionState = 'active' | 'expired' | 'unavailable' | 'disabled'

export async function checkGatewaySession(path: string): Promise<GatewaySessionState> {
    try {
        const response = await fetch(path, {
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'manual',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5_000)
        })
        // This marker is supplied only by the optional gateway endpoint. A
        // direct/local hub returns its SPA/404 instead and must remain usable.
        if (response.headers.get('X-Hapi-Gateway-Session') !== 'protected') return 'disabled'
        if (response.status === 204) return 'active'
        if (response.status === 401 || response.status === 403) return 'expired'
        return 'unavailable'
    } catch {
        // A network outage is not proof of logout. Do not discard drafts or
        // navigate away, and never retry an application write here.
        return 'unavailable'
    }
}
