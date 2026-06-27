'use server'

/**
 * Auth server actions for sign out.
 *
 * NOTE (Phase 3 recording lifecycle): this action is currently unused — sign-out
 * goes through `Sidebar.handleSignOut`, which guards against signing out while an
 * unresolved recording artifact exists. If this server action is ever wired to a
 * button, it must gain the same `hasUnresolvedRecordingArtifact()` guard on the
 * client before invoking it, or it will bypass the auth-boundary protection.
 */
import { createClient } from '@/infra/supabase/server'
import { redirect } from 'next/navigation'

export async function signOut() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/auth')
}
