/**
 * Where a segment splits for a caret position.
 *
 * The break goes between two words of the (possibly edited) text, and the
 * stored words divide at the same place: tokens that stand for exact words
 * take them along, and inside a stretch the user rewrote into a different
 * number of words, the spoken words divide by the alignment's estimated time.
 * Each half must keep at least one spoken word, because a segment's times come
 * from its words.
 */

import type { SourceWord, TokenAlignment } from "./word-alignment";

export interface SegmentSplit {
    /** Text of the segment that stays, trimmed at the break. */
    firstText: string;
    /** Text of the new segment, trimmed at the break. */
    secondText: string;
    /** Index of the first word that moves to the new segment. */
    splitWordIndex: number;
}

/**
 * Index of the token the second half starts with. A caret inside a word goes
 * to that word's nearer edge (a tie goes after it); a caret in the whitespace
 * after a word goes before the next one.
 */
function breakTokenIndex(tokens: readonly TokenAlignment[], caretOffset: number): number {
    let i = tokens.length - 1;
    while (i > 0 && tokens[i].offset > caretOffset) i--;
    const token = tokens[i];
    const wordStart = token.offset + (token.text.length - token.text.trimStart().length);
    const wordEnd = token.offset + token.text.trimEnd().length;
    if (caretOffset >= wordEnd) return i + 1;
    if (caretOffset <= wordStart) return i;
    return caretOffset - wordStart < wordEnd - caretOffset ? i : i + 1;
}

/**
 * The split at `caretOffset` in `text`, or null where there is none: at the
 * very start or end, where a half would have no spoken word, or where the new
 * segment would not start after this one.
 *
 * `tokens` is `alignTokens(text, words, …)` for this text and these words.
 */
export function findSplit(
    tokens: readonly TokenAlignment[],
    words: readonly SourceWord[],
    text: string,
    caretOffset: number,
    segStartMs: number
): SegmentSplit | null {
    if (tokens.length < 2 || words.length < 2) return null;

    const b = breakTokenIndex(tokens, Math.max(0, Math.min(text.length, caretOffset)));
    if (b <= 0 || b >= tokens.length) return null;

    const prev = tokens[b - 1];
    const next = tokens[b];
    let splitWordIndex = next.wordFrom;
    // Both neighbours share one rewritten stretch: divide its words by time.
    // Otherwise the words the next token stands for (or sits before) move.
    if (prev.wordFrom === next.wordFrom && prev.wordTo === next.wordTo && next.wordTo > next.wordFrom) {
        while (
            splitWordIndex < next.wordTo &&
            (words[splitWordIndex].startMs + words[splitWordIndex].endMs) / 2 < next.startMs
        ) {
            splitWordIndex++;
        }
    }
    if (splitWordIndex < 1 || splitWordIndex > words.length - 1) return null;

    // The database orders segments by start time and refuses a new segment
    // that would not start after this one.
    let newStartMs = Infinity;
    for (let k = splitWordIndex; k < words.length; k++) newStartMs = Math.min(newStartMs, words[k].startMs);
    if (newStartMs <= segStartMs) return null;

    const firstText = text.slice(0, next.offset).trimEnd();
    const secondText = text.slice(next.offset).trimStart();
    if (firstText === "" || secondText === "") return null;

    return { firstText, secondText, splitWordIndex };
}
