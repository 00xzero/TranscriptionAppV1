/**
 * Failure messages for transcription jobs, whatever the engine. Key terms are
 * sent to every engine, so their errors are recognised here once.
 */

// Error type constants matching legacy worker and UI
export const ERROR_TYPE_KEYTERM = "keyterm_error" as const;
export const ERROR_TYPE_GENERAL = "transcription_error" as const;

export type ErrorType = typeof ERROR_TYPE_KEYTERM | typeof ERROR_TYPE_GENERAL;

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

    // Soniox carries key terms in `context`, which has a size limit of its own.
    if (
        errorLower.includes("context") &&
        ["limit", "exceed", "too long", "too large"].some((phrase) => errorLower.includes(phrase))
    ) {
        return {
            type: ERROR_TYPE_KEYTERM,
            message:
                "Too many key terms for Soniox. Please use fewer or shorter terms.",
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
