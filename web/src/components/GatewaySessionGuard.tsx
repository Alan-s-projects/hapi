import { useEffect, useState } from 'react'
import { checkGatewaySession } from '@/lib/gatewaySession'

export function GatewaySessionGuard({ path }: { path?: string }) {
    const [expired, setExpired] = useState(false)

    useEffect(() => {
        if (!path) return
        let stopped = false
        let checking = false
        const check = async () => {
            if (stopped || checking) return
            checking = true
            try {
                const state = await checkGatewaySession(path)
                if (stopped) return
                if (state === 'disabled') {
                    stopped = true
                    clearInterval(timer)
                } else if (state === 'active' || state === 'expired') {
                    setExpired(state === 'expired')
                }
            } finally {
                checking = false
            }
        }
        const timer = setInterval(() => { void check() }, 30_000)
        const onVisible = () => { if (document.visibilityState === 'visible') void check() }
        window.addEventListener('focus', check)
        document.addEventListener('visibilitychange', onVisible)
        void check()
        return () => {
            stopped = true
            clearInterval(timer)
            window.removeEventListener('focus', check)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [path])

    if (!expired) return null
    return (
        <div role="alert" className="fixed inset-x-0 top-0 z-[10000] flex flex-wrap items-center justify-center gap-3 bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-lg">
            <span>Gateway sign-in expired. Saved chats and running agents are unchanged.</span>
            <button
                type="button"
                className="rounded bg-amber-950 px-3 py-2 font-medium text-white"
                onClick={() => window.location.assign(window.location.pathname)}
            >
                Sign in again
            </button>
        </div>
    )
}
