/**
 * Shared transcript text helpers used by transcript ingestion and processing.
 */

export const DEFAULT_FILLER_PATTERNS: string[] = [
    "k.", "okay.", "ok.", "yeah.", "yes.", "no.", "mm.", "mhmm.",
    "uh.", "um.", "hmm.", "right.", "sure.", "so.", "well.",
    "yep.", "nope.", "oh.", "ah.", "alright.",
];

/**
 * Check if text ends at a natural sentence boundary.
 */
export function isSentenceBoundary(text: string): boolean {
    const stripped = text.trimEnd();
    return /[.?!"]$/.test(stripped);
}

/**
 * Check if text matches a filler pattern.
 */
export function isFiller(text: string, patterns: string[]): boolean {
    const normalized = text.trim().toLowerCase();

    if (patterns.includes(normalized)) {
        return true;
    }

    for (const pattern of patterns) {
        if (normalized === pattern.replace(/\.$/, "")) {
            return true;
        }
    }

    return false;
}

/**
 * Concatenate texts with proper spacing and punctuation.
 */
export function normalizeText(texts: string[]): string {
    let combined = texts
        .map((text) => text.trim())
        .filter(Boolean)
        .join(" ");

    combined = combined.replace(/\s+/g, " ");
    combined = combined.replace(/([.!?])([A-Za-z])/g, "$1 $2");

    return combined.trim();
}

/**
 * Count whitespace-delimited words.
 */
export function getWordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}
