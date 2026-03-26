'use server'

/**
 * Auth server actions for sign out.
 */
import { createClient } from '@/infra/supabase/server'
import { redirect } from 'next/navigation'

export async function signOut() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/auth')
}
