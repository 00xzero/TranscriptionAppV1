/**
 * What engines that hand back whole words share when turning them into ours
 * (Soniox, AssemblyAI): the plain form of a word, and speaker labels as
 * numbers. Pure.
 */

const OUTER_PUNCTUATION = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;

/** A word's plain form: lower case, without the punctuation around it. */
export function plainWordText(punctuatedText: string): string {
    return punctuatedText.replace(OUTER_PUNCTUATION, "").toLowerCase();
}

/**
 * Turns an engine's speaker labels into 0, 1, 2… in the order they first
 * speak. A word without a label has no speaker.
 */
export function speakerNumberer(): (label: string | null | undefined) => number | null {
    const numbers = new Map<string, number>();
    return (label) => {
        if (label === null || label === undefined) return null;
        if (!numbers.has(label)) numbers.set(label, numbers.size);
        return numbers.get(label) ?? null;
    };
}
