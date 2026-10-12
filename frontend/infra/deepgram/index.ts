/**
 * Deepgram Async Transcription Service
 *
 * Handles async transcription requests with callback webhooks.
 * Ported from legacy worker/app/worker.py
 */

const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen";

// Error type constants matching legacy worker and UI
export const ERROR_TYPE_KEYTERM = "keyterm_error" as const;
export const ERROR_TYPE_GENERAL = "transcription_error" as const;

export type ErrorType = typeof ERROR_TYPE_KEYTERM | typeof ERROR_TYPE_GENERAL;

export interface DeepgramAsyncOptions {
    mediaUrl: string;
    callbackUrl: string;
    transcriptId: string;
    keyTerms?: string[];
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
export type { DeepgramAsyncResponse, DeepgramWord, DeepgramUtterance, DeepgramParagraph, DeepgramSentence, DeepgramResponse }

/**
 * Get the callback URL for Deepgram webhooks.
 * Priority: DEEPGRAM_CALLBACK_URL > NEXT_PUBLIC_APP_URL + path
 */
export function getCallbackUrl(): string {
    // Explicit override takes priority (for ngrok/tunnels in local dev)
    const explicitUrl = process.env.DEEPGRAM_CALLBACK_URL;
    if (explicitUrl) {
        return explicitUrl;
    }

    // Derive from app URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
        throw new Error(
            "NEXT_PUBLIC_APP_URL or DEEPGRAM_CALLBACK_URL must be configured for Deepgram webhooks"
        );
    }

    // Remove trailing slash and append webhook path
    const baseUrl = appUrl.replace(/\/$/, "");
    return `${baseUrl}/api/webhooks/deepgram`;
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

    const { mediaUrl, callbackUrl, transcriptId, keyTerms, model } = options;

    // Build query parameters
    const params = new URLSearchParams();
    params.append("model", model || getDeepgramModel());
    params.append("smart_format", "true");
    params.append("paragraphs", "true");
    // Speaker detection. `diarize=true` is deprecated and always uses the v1
    // diarizer; `latest` follows Deepgram's newest batch diarizer. Deepgram
    // rejects requests that send both.
    params.append("diarize_model", "latest");
    // Keep "uh" and "um" in the transcript; Deepgram drops them by default.
    params.append("filler_words", "true");
    // Keep the audio out of Deepgram's Model Improvement Program: Deepgram then
    // holds it only while processing, so deleting a transcript leaves no copy.
    params.append("mip_opt_out", "true");
    params.append("callback", callbackUrl);

    const tag = getDeepgramTag();
    if (tag) {
        params.append("tag", tag);
    }

    // Pass transcript ID via extra parameter (returned in metadata.extra in callback)
    params.append("extra", `transcript_id:${transcriptId}`);

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
            const errorText = await response.text();
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
        console.error("[deepgram] Request failed:", error);
        return {
            requestId: null,
            error: `Deepgram request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Classify an error and return user-friendly message.
 * Ported from legacy worker._classify_error()
 */
export function classifyError(errorText: string): {
    type: ErrorType;
    message: string;
} {
    const errorLower = errorText.toLowerCase();

    // Keyterm limit exceeded
    if (errorLower.includes("keyterm") && errorLower.includes("limit")) {
        return {
            type: ERROR_TYPE_KEYTERM,
            message:
                "Too many key terms. Please reduce to fewer terms or shorter phrases.",
        };
    }

    // Token limit (keyterms use tokens internally)
    if (
        errorLower.includes("token") &&
        (errorLower.includes("limit") || errorLower.includes("exceed"))
    ) {
        return {
            type: ERROR_TYPE_KEYTERM,
            message:
                "Key terms exceed the token limit. Try using fewer multi-word phrases.",
        };
    }

    // Generic keyterm error
    if (errorLower.includes("keyterm") || errorLower.includes("keyword")) {
        return {
            type: ERROR_TYPE_KEYTERM,
            message:
                "There was an issue with your key terms. Please review and try again.",
        };
    }

    // General transcription error
    return {
        type: ERROR_TYPE_GENERAL,
        message: `Transcription failed: ${errorText.slice(0, 200)}`,
    };
}
