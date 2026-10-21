/**
 * Soniox async transcription (https://soniox.com/docs/stt/async/async-transcription).
 *
 * A job reads the audio from our signed URL and calls back with only its id and
 * status, so the result is fetched once it is done. Soniox keeps every job for
 * 30 days unless it is deleted, and counts it against the account's quota, so
 * each one is deleted once its result is safely ours.
 */

import {
    SonioxCreateResponseSchema,
    SonioxTranscriptSchema,
    SonioxTranscriptionSchema,
    type SonioxTranscript,
    type SonioxTranscription,
} from "@/contracts/soniox";
import { TRANSCRIPTION_LANGUAGES, type TranscriptionOptions } from "@/contracts/transcription-options";
import { getPublicBaseUrl } from "@/infra/public-url";

const SONIOX_API_URL = "https://api.soniox.com/v1";

/** The header Soniox sends with each callback, carrying our secret. */
export const SONIOX_WEBHOOK_AUTH_HEADER = "Authorization";

export function getSonioxModel(): string {
    return process.env.SONIOX_MODEL || "stt-async-v5";
}

/** The callback names the exact job attempt, so a late callback can't touch a newer one. */
export function getSonioxCallbackUrl({ transcriptId, jobId }: { transcriptId: string; jobId: string }): string {
    const base = getPublicBaseUrl();
    if (!base) {
        throw new Error("NEXT_PUBLIC_APP_URL or DEEPGRAM_CALLBACK_URL must be configured for Soniox webhooks");
    }
    const params = new URLSearchParams({ transcript_id: transcriptId, job_id: jobId });
    return `${base}/api/webhooks/soniox?${params.toString()}`;
}

/** The request body Soniox is sent for a job. */
export function buildSonioxRequest(input: {
    mediaUrl: string;
    jobId: string;
    keyTerms?: string[];
    options: TranscriptionOptions;
    webhookUrl: string;
    webhookSecret: string;
}): Record<string, unknown> {
    const { mediaUrl, jobId, keyTerms, options, webhookUrl, webhookSecret } = input;
    const body: Record<string, unknown> = {
        model: getSonioxModel(),
        audio_url: mediaUrl,
        client_reference_id: jobId,
        enable_speaker_diarization: options.detect_speakers,
        webhook_url: webhookUrl,
        webhook_auth_header_name: SONIOX_WEBHOOK_AUTH_HEADER,
        webhook_auth_header_value: `Bearer ${webhookSecret}`,
    };

    if (options.language === "multi") {
        // Mixed audio: each piece is labelled with its language, and the ten
        // languages offered are a hint rather than a restriction.
        body.enable_language_identification = true;
        body.language_hints = TRANSCRIPTION_LANGUAGES.filter((language) => language !== "multi");
    } else {
        // One language, held to it: Soniox recommends strict hints with a
        // single language.
        body.language_hints = [options.language];
        body.language_hints_strict = true;
    }

    if (keyTerms && keyTerms.length > 0) {
        body.context = { terms: keyTerms };
    }

    return body;
}

function apiKey(): string | null {
    return process.env.SONIOX_API_KEY || null;
}

async function sonioxFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const key = apiKey();
    if (!key) throw new Error("SONIOX_API_KEY is not configured");
    return fetch(`${SONIOX_API_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key}`, ...init.headers },
    });
}

async function describeFailure(response: Response): Promise<string> {
    const text = await response.text().catch(() => "");
    return `Soniox API error: ${response.status} - ${text.slice(0, 500)}`;
}

/** Start a job. Its id, which the callback names again, becomes the job's request id. */
export async function startSonioxTranscription(input: {
    mediaUrl: string;
    transcriptId: string;
    jobId: string;
    keyTerms?: string[];
    options: TranscriptionOptions;
}): Promise<{ requestId: string; error: null } | { requestId: null; error: string }> {
    const secret = process.env.SONIOX_WEBHOOK_SECRET;
    if (!apiKey()) return { requestId: null, error: "SONIOX_API_KEY is not configured" };
    if (!secret) return { requestId: null, error: "SONIOX_WEBHOOK_SECRET is not configured" };

    let body: Record<string, unknown>;
    try {
        body = buildSonioxRequest({
            ...input,
            webhookUrl: getSonioxCallbackUrl(input),
            webhookSecret: secret,
        });
    } catch (error) {
        return { requestId: null, error: error instanceof Error ? error.message : String(error) };
    }

    try {
        const response = await sonioxFetch("/transcriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = await describeFailure(response);
            console.error("[soniox]", error);
            return { requestId: null, error };
        }
        const created = SonioxCreateResponseSchema.safeParse(await response.json());
        if (!created.success) {
            return { requestId: null, error: "Soniox response missing the transcription id" };
        }
        console.log(`[soniox] Async transcription started: ${created.data.id}`);
        return { requestId: created.data.id, error: null };
    } catch (error) {
        return {
            requestId: null,
            error: `Soniox request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * The job itself: its status, and its error when it failed. Returned as Soniox
 * sent it too, for storing.
 */
export async function fetchSonioxTranscription(id: string): Promise<{ raw: unknown; transcription: SonioxTranscription }> {
    const response = await sonioxFetch(`/transcriptions/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(await describeFailure(response));
    const raw: unknown = await response.json();
    return { raw, transcription: SonioxTranscriptionSchema.parse(raw) };
}

/**
 * The job's transcript, served for completed jobs only. Returned as the text
 * Soniox sent, checked against the schema, so it can be stored as it came.
 */
export async function fetchSonioxTranscript(id: string): Promise<{ raw: unknown; transcript: SonioxTranscript }> {
    const response = await sonioxFetch(`/transcriptions/${encodeURIComponent(id)}/transcript`);
    if (!response.ok) throw new Error(await describeFailure(response));
    const raw: unknown = await response.json();
    return { raw, transcript: SonioxTranscriptSchema.parse(raw) };
}

/** Delete the job and what Soniox kept of it. One already gone counts as deleted. */
export async function deleteSonioxTranscription(id: string): Promise<void> {
    const response = await sonioxFetch(`/transcriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok || response.status === 404) return;
    throw new Error(await describeFailure(response));
}
