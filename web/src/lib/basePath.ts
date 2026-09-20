import { normalizeBasePath, stripBasePath } from '@hapi/protocol/url'

export const appBasePath = normalizeBasePath(import.meta.env.BASE_URL)

export function appPath(path: string): string {
    if (appBasePath && (path === appBasePath || path.startsWith(`${appBasePath}/`))) return path
    return `${appBasePath}${path.startsWith('/') ? path : `/${path}`}`
}

export function appPathname(pathname: string): string {
    return stripBasePath(pathname, appBasePath) ?? pathname
}
