/**
 * Auth callback route for Supabase.
 * 
 * Handles the code exchange after OAuth or magic link authentication.
 * Supabase redirects here with an auth code that we exchange for a session.
 */
import { createClient } from '@/infra/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? ''
    const safeNext = (() => {
        if (!next) {
            return '/projects'
        }

        try {
            const nextUrl = new URL(next, origin)
            if (nextUrl.origin === origin) {
                return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
            }
        } catch {
            // Fall through to default
        }

        return '/projects'
    })()

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error) {
            // Successful auth - redirect to intended destination
            return NextResponse.redirect(`${origin}${safeNext}`)
        }
    }

    // Auth code exchange failed - redirect to auth page with error
    return NextResponse.redirect(`${origin}/auth?error=auth_callback_error`)
}
