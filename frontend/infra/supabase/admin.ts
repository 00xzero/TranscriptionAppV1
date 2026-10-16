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

function readAdminConfig(): { supabaseUrl: string; serviceRoleKey: string } {
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

    return { supabaseUrl, serviceRoleKey };
}

/**
 * Create a Supabase client with service role privileges.
 * This client bypasses RLS and should only be used in trusted server contexts.
 */
export function createAdminClient(): SupabaseClient {
    if (adminClient) {
        return adminClient;
    }

    const { supabaseUrl, serviceRoleKey } = readAdminConfig();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    return adminClient;
}

/**
 * A one-off service-role client whose every request is cancelled when
 * `signal` aborts. Storage's `.upload()` takes no signal of its own, so a
 * deadline-bound upload goes through this client's fetch instead. Not cached.
 */
export function createAbortableAdminClient(signal: AbortSignal): SupabaseClient {
    const { supabaseUrl, serviceRoleKey } = readAdminConfig();
    const abortableFetch: typeof fetch = (input, init) =>
        fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
        global: { fetch: abortableFetch },
    });
}
