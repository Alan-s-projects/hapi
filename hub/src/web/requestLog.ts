/** Request queries can contain SSE JWTs, login tokens, or nested redirect URLs. */
export function redactRequestLog(message: string): string {
    return message.replace(/\?[^\s]*/g, '?[REDACTED]')
}
