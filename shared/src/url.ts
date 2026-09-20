/** Canonical deployment prefix. Empty string means the origin root. */
export function normalizeBasePath(value: string = ''): string {
    const raw = value.trim()
    if (!raw || raw === '/') return ''
    const path = raw.replace(/\/$/, '')
    if (!/^\/(?:[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_-]+)*$/.test(path)) {
        throw new Error('Base path must contain only slash-separated letters, numbers, underscores or hyphens')
    }
    return path
}

export function normalizeHubUrl(value: string): string {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Hub URL must be HTTP(S), without credentials, query or fragment')
    }
    return url.origin + normalizeBasePath(url.pathname)
}

/** Join a hub-relative endpoint without dropping a configured URL prefix. */
export function hubUrl(base: string, path: string): string {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
        throw new Error('Expected a hub-relative path')
    }
    if (!base) return path
    return `${normalizeHubUrl(base)}${path}`
}

export function socketEndpoint(base: string): { origin: string; path: string } {
    if (!base) return { origin: '', path: '/socket.io/' }
    const url = new URL(normalizeHubUrl(base))
    return { origin: url.origin, path: `${normalizeBasePath(url.pathname)}/socket.io/` }
}

/** Match only the exact prefix boundary; encoded/lookalike prefixes never match. */
export function stripBasePath(pathname: string, basePath: string): string | null {
    const base = normalizeBasePath(basePath)
    if (!base) return pathname
    if (pathname === base) return '/'
    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null
}
