/**
 * Shared helpers for Inngest function handlers.
 */

import { createAdminClient } from "@/infra/supabase/admin";
import { forceJobError } from "@/core/transcription/transition";

export type TranscriptionFailurePayload = {
    error: string;
    error_type: string;
    raw_error: string;
};

export async function writeTranscriptionFailureFallback({
    projectId,
    jobId,
    payload,
    context,
}: {
    projectId: string;
    jobId?: string;
    payload: TranscriptionFailurePayload;
    context: string;
}) {
    try {
        const supabase = createAdminClient();

        if (jobId) {
            await forceJobError({
                supabase,
                jobId,
                extraJobFields: {
                    finished_at: new Date().toISOString(),
                    payload,
                },
                context: `${context}/fallback`,
            });
            // Project status derived by trigger
        } else {
            console.error(`[inngest] ${context} fallback: no jobId, marking project ${projectId} as error directly`);

            const { error: projectError } = await supabase
                .from("projects")
                .update({ status: "error" })
                .eq("id", projectId);

            if (projectError) {
                console.error(`[inngest] Failed to update project in ${context} fallback:`, projectError);
            }
        }
    } catch (dbError) {
        console.error(`[inngest] ${context} fallback failed:`, dbError);
    }
}
