import { normalizeBasePath, stripBasePath } from '@hapi/protocol/url'

export function hubBasePath(): string {
    return normalizeBasePath(process.env.HAPI_BASE_PATH)
}

/** HTTP handlers see canonical paths. WebSocket upgrades retain the original Request. */
export function routeBasePath(request: Request, base: string): { url: URL; request: Request } | Response {
    const url = new URL(request.url)
    const pathname = stripBasePath(url.pathname, base)
    if (pathname === null) return new Response('Not found', { status: 404 })
    if (base && url.pathname === base) {
        return new Response(null, { status: 308, headers: { Location: `${base}/${url.search}` } })
    }
    if (!base) return { url, request }
    url.pathname = pathname
    return { url, request: new Request(url.toString(), request) }
}
