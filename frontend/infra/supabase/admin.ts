/**
 * Supabase Admin Client
 *
 * Uses service role key to bypass RLS policies.
 * Only use in server-side contexts (API routes, Inngest functions).
 *
 * NEVER expose this client to the browser.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

/**
 * Create a Supabase client with service role privileges.
 * This client bypasses RLS and should only be used in trusted server contexts.
 */
export function createAdminClient(): SupabaseClient {
    if (adminClient) {
        return adminClient;
    }

    // Use SUPABASE_URL for server-side (Docker: host.docker.internal:54321)
    // Fall back to NEXT_PUBLIC_SUPABASE_URL for non-Docker environments
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
        throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is not configured");
    }

    if (!serviceRoleKey) {
        throw new Error(
            "SUPABASE_SERVICE_ROLE_KEY is not configured. " +
            "Get it from Supabase Dashboard → Settings → API → service_role (secret)"
        );
    }

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    return adminClient;
}
