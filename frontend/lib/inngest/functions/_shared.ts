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
    transcriptId,
    jobId,
    payload,
    context,
}: {
    transcriptId: string;
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
            // Transcript status derived by trigger
        } else {
            console.error(`[inngest] ${context} fallback: no jobId, marking transcript ${transcriptId} as error directly`);

            const { error: transcriptError } = await supabase
                .from("transcripts")
                .update({ status: "error" })
                .eq("id", transcriptId);

            if (transcriptError) {
                console.error(`[inngest] Failed to update transcript in ${context} fallback:`, transcriptError);
            }
        }
    } catch (dbError) {
        console.error(`[inngest] ${context} fallback failed:`, dbError);
    }
}
