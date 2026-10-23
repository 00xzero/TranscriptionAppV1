/**
 * AssemblyAI pre-recorded transcription (https://www.assemblyai.com/docs/pre-recorded-audio),
 * on its EU servers.
 *
 * A transcript reads the audio from our signed URL and calls back with only
 * its id and status, so the result is fetched once it is done. AssemblyAI
 * keeps every transcript for 30 days unless it is deleted, so each one is
 * deleted once its result is safely ours.
 */

import {
    AssemblyAICreateResponseSchema,
    AssemblyAITranscriptSchema,
    type AssemblyAITranscript,
} from "@/contracts/assemblyai";
import type { TranscriptionLanguage, TranscriptionOptions } from "@/contracts/transcription-options";
import { getPublicBaseUrl } from "@/infra/public-url";

/** The EU servers, unless another region is configured. */
export function getAssemblyAIApiUrl(): string {
    return (process.env.ASSEMBLYAI_API_URL || "https://api.eu.assemblyai.com").replace(/\/$/, "");
}

/** The header AssemblyAI sends with each callback, carrying our secret. */
export const ASSEMBLYAI_WEBHOOK_AUTH_HEADER = "Authorization";

// Universal-3.5 Pro first; a language it lacks (of ours, Russian) falls back to
// Universal-2.
export const ASSEMBLYAI_SPEECH_MODELS = ["universal-3-5-pro", "universal-2"] as const;

// Mixed languages: the nine of ours Universal-3.5 Pro follows. Russian is left
// out: with it in the list AssemblyAI moves the whole file to Universal-2,
// which keeps the Russian and drops every other language.
export const ASSEMBLYAI_MIXED_LANGUAGES: readonly TranscriptionLanguage[] = [
    "en", "es", "fr", "de", "pt", "it", "nl", "ja", "hi",
];

/** The callback names the exact job attempt, so a late callback can't touch a newer one. */
export function getAssemblyAICallbackUrl({ transcriptId, jobId }: { transcriptId: string; jobId: string }): string {
    const base = getPublicBaseUrl();
    if (!base) {
        throw new Error("NEXT_PUBLIC_APP_URL or DEEPGRAM_CALLBACK_URL must be configured for AssemblyAI webhooks");
    }
    const params = new URLSearchParams({ transcript_id: transcriptId, job_id: jobId });
    return `${base}/api/webhooks/assemblyai?${params.toString()}`;
}

/** The request body AssemblyAI is sent for a job. */
export function buildAssemblyAIRequest(input: {
    mediaUrl: string;
    keyTerms?: string[];
    options: TranscriptionOptions;
    webhookUrl: string;
    webhookSecret: string;
}): Record<string, unknown> {
    const { mediaUrl, keyTerms, options, webhookUrl, webhookSecret } = input;
    const body: Record<string, unknown> = {
        audio_url: mediaUrl,
        speech_models: [...ASSEMBLYAI_SPEECH_MODELS],
        speaker_labels: options.detect_speakers,
        // Universal-3.5 Pro keeps "um" and "uh" whatever it is asked; this has
        // Universal-2 keep them too, so every AssemblyAI transcript does.
        disfluencies: true,
        webhook_url: webhookUrl,
        webhook_auth_header_name: ASSEMBLYAI_WEBHOOK_AUTH_HEADER,
        webhook_auth_header_value: `Bearer ${webhookSecret}`,
    };

    if (options.language === "multi") {
        body.language_codes = [...ASSEMBLYAI_MIXED_LANGUAGES];
    } else {
        body.language_code = options.language;
    }

    // Recorded on only where AssemblyAI can mask (not Russian, which it refuses).
    if (options.mask_profanity) body.filter_profanity = true;

    if (keyTerms && keyTerms.length > 0) {
        body.keyterms_prompt = keyTerms;
    }

    return body;
}

function apiKey(): string | null {
    return process.env.ASSEMBLYAI_API_KEY || null;
}

async function assemblyAIFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const key = apiKey();
    if (!key) throw new Error("ASSEMBLYAI_API_KEY is not configured");
    // The key goes as it is, without "Bearer".
    return fetch(`${getAssemblyAIApiUrl()}${path}`, {
        ...init,
        headers: { Authorization: key, ...init.headers },
    });
}

async function describeFailure(response: Response): Promise<string> {
    const text = await response.text().catch(() => "");
    return `AssemblyAI API error: ${response.status} - ${text.slice(0, 500)}`;
}

/** Start a transcript. Its id, which the callback names again, becomes the job's request id. */
export async function startAssemblyAITranscription(input: {
    mediaUrl: string;
    transcriptId: string;
    jobId: string;
    keyTerms?: string[];
    options: TranscriptionOptions;
}): Promise<{ requestId: string; error: null } | { requestId: null; error: string }> {
    const secret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
    if (!apiKey()) return { requestId: null, error: "ASSEMBLYAI_API_KEY is not configured" };
    if (!secret) return { requestId: null, error: "ASSEMBLYAI_WEBHOOK_SECRET is not configured" };

    let body: Record<string, unknown>;
    try {
        body = buildAssemblyAIRequest({
            ...input,
            webhookUrl: getAssemblyAICallbackUrl(input),
            webhookSecret: secret,
        });
    } catch (error) {
        return { requestId: null, error: error instanceof Error ? error.message : String(error) };
    }

    try {
        const response = await assemblyAIFetch("/v2/transcript", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = await describeFailure(response);
            console.error("[assemblyai]", error);
            return { requestId: null, error };
        }
        const created = AssemblyAICreateResponseSchema.safeParse(await response.json());
        if (!created.success) {
            return { requestId: null, error: "AssemblyAI response missing the transcript id" };
        }
        console.log(`[assemblyai] Transcription started: ${created.data.id}`);
        return { requestId: created.data.id, error: null };
    } catch (error) {
        return {
            requestId: null,
            error: `AssemblyAI request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * The transcript, or its error when it failed. Returned as AssemblyAI sent it
 * too, for storing.
 */
export async function fetchAssemblyAITranscript(id: string): Promise<{ raw: unknown; transcript: AssemblyAITranscript }> {
    const response = await assemblyAIFetch(`/v2/transcript/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(await describeFailure(response));
    const raw: unknown = await response.json();
    return { raw, transcript: AssemblyAITranscriptSchema.parse(raw) };
}

/**
 * Delete the transcript and what AssemblyAI kept of it. Deleting one already
 * deleted succeeds; one AssemblyAI no longer knows answers 400 "not found",
 * which counts as deleted too. Anything else (one still running is refused)
 * throws.
 */
export async function deleteAssemblyAITranscript(id: string): Promise<void> {
    const response = await assemblyAIFetch(`/v2/transcript/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) return;
    const text = await response.text().catch(() => "");
    if ((response.status === 400 || response.status === 404) && /not found/i.test(text)) return;
    throw new Error(`AssemblyAI API error: ${response.status} - ${text.slice(0, 500)}`);
}
