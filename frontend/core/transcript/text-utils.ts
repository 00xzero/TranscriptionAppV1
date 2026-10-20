/**
 * Shared transcript text helpers used by transcript ingestion and processing.
 */

export const DEFAULT_FILLER_PATTERNS: string[] = [
    "k.", "okay.", "ok.", "yeah.", "yes.", "no.", "mm.", "mhmm.",
    "uh.", "um.", "hmm.", "right.", "sure.", "so.", "well.",
    "yep.", "nope.", "oh.", "ah.", "alright.",
];

// Characters of the scripts written without spaces between words (Japanese):
// Han, Hiragana and Katakana, and the long-vowel mark ー (and its halfwidth ｰ),
// which Unicode files under no script of its own.
const NO_SPACE_CLASS = "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ーｰ]";
/** Text holding a character of a script written without spaces. */
export const NO_SPACE_CHAR = new RegExp(NO_SPACE_CLASS, "u");
/** Text starting with one. */
export const STARTS_NO_SPACE = new RegExp(`^${NO_SPACE_CLASS}`, "u");
/** Text ending with one. */
export const ENDS_NO_SPACE = new RegExp(`${NO_SPACE_CLASS}$`, "u");

// Sentence ends in the languages offered: ASCII, Japanese full-width 。！？ and
// the halfwidth ｡, and the Devanagari danda । and double danda ॥. Japanese
// closing brackets after one (「…。」) still end the sentence.
const SENTENCE_END = /(?:[.?!"]|[.?!。！？｡।॥][」』）]+|[。！？｡।॥])$/u;

/**
 * Check if text ends at a natural sentence boundary.
 */
export function isSentenceBoundary(text: string): boolean {
    const stripped = text.trimEnd();
    return SENTENCE_END.test(stripped);
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
