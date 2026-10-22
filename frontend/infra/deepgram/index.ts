/**
 * Deepgram Async Transcription Service
 *
 * Handles async transcription requests with callback webhooks.
 * Ported from legacy worker/app/worker.py
 */

const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen";

export interface DeepgramAsyncOptions {
    mediaUrl: string;
    callbackUrl: string;
    transcriptId: string;
    /** The job attempt, named again in the callback. */
    jobId: string;
    /** The transcript's owner, so the callback can find the result's folder. */
    userId: string;
    keyTerms?: string[];
    transcription: TranscriptionOptions;
    model?: string;
}

// Import and re-export from contracts layer — single source of truth
import type {
    DeepgramAsyncResponse,
    DeepgramWord,
    DeepgramUtterance,
    DeepgramParagraph,
    DeepgramSentence,
    DeepgramWebhookPayload as DeepgramResponse,
} from '@/contracts/webhook'
import type { TranscriptionOptions } from '@/contracts/transcription-options'
import { fillerWordsApply } from '@/core/transcription/engines/capabilities'
export type { DeepgramAsyncResponse, DeepgramWord, DeepgramUtterance, DeepgramParagraph, DeepgramSentence, DeepgramResponse }

/** The Basic Auth user Deepgram's callbacks carry; the password is DEEPGRAM_WEBHOOK_SECRET. */
export const DEEPGRAM_WEBHOOK_USER = "deepgram";

/** Our own secret, hex only so nothing in the callback URL needs encoding. */
const WEBHOOK_SECRET_PATTERN = /^[0-9a-f]{32,}$/i;

/** Text that may quote the callback URL, with our secret taken out before it is logged or stored. */
export function withoutWebhookSecret(text: string): string {
    const secret = process.env.DEEPGRAM_WEBHOOK_SECRET;
    return secret ? text.split(secret).join("***") : text;
}

/**
 * Get the callback URL for Deepgram webhooks, carrying our credentials:
 * Deepgram sends them back as Basic Auth on every callback, which the route
 * checks (https://developers.deepgram.com/docs/callback).
 * Priority: DEEPGRAM_CALLBACK_URL > NEXT_PUBLIC_APP_URL + path
 */
export function getCallbackUrl(): string {
    const secret = process.env.DEEPGRAM_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error("DEEPGRAM_WEBHOOK_SECRET must be configured for Deepgram webhooks");
    }
    if (!WEBHOOK_SECRET_PATTERN.test(secret)) {
        throw new Error("DEEPGRAM_WEBHOOK_SECRET must be hex (openssl rand -hex 32)");
    }

    // Explicit override takes priority (for ngrok/tunnels in local dev)
    let url = process.env.DEEPGRAM_CALLBACK_URL;
    if (!url) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        if (!appUrl) {
            throw new Error(
                "NEXT_PUBLIC_APP_URL or DEEPGRAM_CALLBACK_URL must be configured for Deepgram webhooks"
            );
        }
        url = `${appUrl.replace(/\/$/, "")}/api/webhooks/deepgram`;
    }

    const callback = new URL(url);
    callback.username = DEEPGRAM_WEBHOOK_USER;
    callback.password = secret;
    return callback.toString();
}

/**
 * Get the Deepgram model to use.
 * Default: nova-3. Deepgram has no "latest" model alias; the separate `version`
 * parameter already defaults to the newest release of the chosen model.
 */
export function getDeepgramModel(): string {
    return process.env.DEEPGRAM_MODEL || "nova-3";
}

/**
 * Label for Deepgram usage reports, so local and hosted spend can be told apart.
 * Unset sends no tag.
 */
export function getDeepgramTag(): string | null {
    return process.env.DEEPGRAM_TAG || null;
}

/**
 * Start an async transcription job with Deepgram.
 *
 * @param options - Transcription options
 * @returns The request_id from Deepgram for tracking
 */
export async function startAsyncTranscription(
    options: DeepgramAsyncOptions
): Promise<{ requestId: string; error: null } | { requestId: null; error: string }> {
    const apiKey = process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
        return {
            requestId: null,
            error: "DEEPGRAM_API_KEY is not configured",
        };
    }

    const { mediaUrl, callbackUrl, transcriptId, jobId, userId, keyTerms, transcription, model } = options;

    // Build query parameters
    const params = new URLSearchParams();
    params.append("model", model || getDeepgramModel());
    params.append("smart_format", "true");
    params.append("paragraphs", "true");
    params.append("language", transcription.language);
    // Speaker detection. `diarize=true` is deprecated and always uses the v1
    // diarizer; `latest` follows Deepgram's newest batch diarizer. Deepgram
    // rejects requests that send both. Left out, nobody is told apart.
    if (transcription.detect_speakers) {
        params.append("diarize_model", "latest");
    }
    // Keep "uh" and "um" in the transcript; Deepgram drops them by default.
    // English only, so other languages never ask.
    if (transcription.keep_filler_words && fillerWordsApply("deepgram", transcription.language)) {
        params.append("filler_words", "true");
    }
    // Swear words come back as asterisks, in the transcript and its words.
    if (transcription.mask_profanity) {
        params.append("profanity_filter", "true");
    }
    // Keep the audio out of Deepgram's Model Improvement Program: Deepgram then
    // holds it only while processing, so deleting a transcript leaves no copy.
    params.append("mip_opt_out", "true");
    params.append("callback", callbackUrl);

    const tag = getDeepgramTag();
    if (tag) {
        params.append("tag", tag);
    }

    // Deepgram returns these in the callback's metadata.extra: the exact job
    // attempt the result belongs to, and the folder it is stored in.
    params.append("extra", `transcript_id:${transcriptId}`);
    params.append("extra", `job_id:${jobId}`);
    params.append("extra", `user_id:${userId}`);

    // Add key terms if provided (using Deepgram's keyterm parameter)
    if (keyTerms && keyTerms.length > 0) {
        console.log(`[deepgram] Sending ${keyTerms.length} key terms`);
        for (const term of keyTerms) {
            params.append("keyterm", term);
        }
    }

    const url = `${DEEPGRAM_API_URL}?${params.toString()}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Token ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                url: mediaUrl,
            }),
        });

        if (!response.ok) {
            // Deepgram's answer can quote the callback URL, which carries our secret.
            const errorText = withoutWebhookSecret(await response.text());
            console.error("[deepgram] API error:", response.status, errorText);
            return {
                requestId: null,
                error: `Deepgram API error: ${response.status} - ${errorText}`,
            };
        }

        const data: DeepgramAsyncResponse = await response.json();

        if (!data.request_id) {
            return {
                requestId: null,
                error: "Deepgram response missing request_id",
            };
        }

        console.log(`[deepgram] Async transcription started: ${data.request_id}`);

        return {
            requestId: data.request_id,
            error: null,
        };
    } catch (error) {
        const message = withoutWebhookSecret(error instanceof Error ? error.message : String(error));
        console.error("[deepgram] Request failed:", message);
        return {
            requestId: null,
            error: `Deepgram request failed: ${message}`,
        };
    }
}
