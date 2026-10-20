/**
 * Line a segment's (possibly edited) text up against the words the engine heard.
 *
 * The stored words are a fixed record of the audio; the segment text is the
 * user's version. Every token of the text gets a time: tokens that still match
 * a word keep that word's exact timing, and everything else is a deterministic
 * estimate placed inside the time window it sits in. Aligning against the
 * original words every time means estimates never compound across edits.
 *
 * Text written without spaces (Japanese) is matched character by character:
 * each such character of the text and of the words is its own unit, and the
 * characters that match one word are joined back into one token for it, so
 * click-to-seek and the playing-word highlight work per word there too.
 */

import { NO_SPACE_CHAR } from "./text-utils";

export interface SourceWord {
    text: string;
    startMs: number;
    endMs: number;
}

export interface AlignedToken {
    /** Token text including its trailing whitespace; tokens join back to the input text. */
    text: string;
    startMs: number;
    endMs: number;
}

/**
 * A token with its place in the text and the stored words it stands for, as
 * the half-open index range [wordFrom, wordTo). A token that matches or
 * corrects one word covers that word; the tokens of a rewritten stretch share
 * the stretch's whole range; a typed-in token covers none and sits just before
 * word `wordFrom`.
 */
export interface TokenAlignment extends AlignedToken {
    /** Where the token starts in the text. */
    offset: number;
    wordFrom: number;
    wordTo: number;
}

// Above this many LCS cells (a large paste), alignment is skipped and the
// tokens are spread evenly across the words' window instead. Cells are counted
// in words, so text matched character by character (Japanese) is held to the
// same limit as text matched word by word.
export const MAX_ALIGNMENT_CELLS = 40_000;

function comparisonKey(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function tokenize(text: string): string[] {
    const pieces = text.match(/\S+\s*/g) ?? [];
    if (pieces.length === 0) return [];
    const leading = text.length - text.trimStart().length;
    if (leading > 0) pieces[0] = text.slice(0, leading) + pieces[0];
    return pieces;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Split text holding characters of a script written without spaces into one
 * piece per such character; a run of other letters or digits stays one piece,
 * and punctuation, marks and trailing spaces stay with the piece before them.
 * Text without such characters comes back whole.
 */
function splitNoSpaceRuns(text: string): string[] {
    if (!NO_SPACE_CHAR.test(text)) return [text];
    const pieces: string[] = [];
    let previous: "no-space" | "word" | null = null;
    for (const char of Array.from(text)) {
        const kind = NO_SPACE_CHAR.test(char) ? "no-space" : WORD_CHAR.test(char) ? "word" : null;
        const starts = kind === "no-space" || (kind === "word" && previous !== "word");
        if (starts || pieces.length === 0) pieces.push(char);
        else pieces[pieces.length - 1] += char;
        if (kind) previous = kind;
    }
    return pieces;
}

interface WordUnit {
    key: string;
    startMs: number;
    endMs: number;
    /** The stored word this unit is part of. */
    word: number;
}

/** Each word as units: a word in a script written without spaces gives one per character, sharing its time. */
function wordUnits(words: readonly SourceWord[]): WordUnit[] {
    return words.flatMap((word, index) => {
        const parts = splitNoSpaceRuns(word.text);
        if (parts.length === 1) return [{ key: comparisonKey(word.text), startMs: word.startMs, endMs: word.endMs, word: index }];
        return spread(parts.length, word.startMs, word.endMs).map((t, k) => ({
            key: comparisonKey(parts[k]),
            ...t,
            word: index,
        }));
    });
}

/** Spread `count` tokens evenly across [startMs, endMs]. */
function spread(count: number, startMs: number, endMs: number): Array<{ startMs: number; endMs: number }> {
    const span = Math.max(0, endMs - startMs);
    const per = span / count;
    return Array.from({ length: count }, (_, i) => ({
        startMs: startMs + Math.round(i * per),
        endMs: i === count - 1 ? startMs + span : startMs + Math.round((i + 1) * per),
    }));
}

/**
 * Anchor pairs [tokenIndex, wordIndex] from a longest-common-subsequence match.
 * Ties break toward the earliest optimal match: when a token equals a word and
 * taking that pair keeps the match optimal, it is taken.
 */
function matchAnchors(tokenKeys: string[], wordKeys: string[]): Array<[number, number]> {
    const n = tokenKeys.length;
    const m = wordKeys.length;
    const width = m + 1;
    // dp[i * width + j] = LCS length of tokenKeys[i:] and wordKeys[j:].
    const dp = new Int32Array((n + 1) * width);
    const equal = (i: number, j: number) => tokenKeys[i] !== "" && tokenKeys[i] === wordKeys[j];

    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * width + j] = equal(i, j)
                ? 1 + dp[(i + 1) * width + j + 1]
                : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
        }
    }

    const anchors: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (equal(i, j) && dp[i * width + j] === 1 + dp[(i + 1) * width + j + 1]) {
            anchors.push([i, j]);
            i++;
            j++;
        } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    return anchors;
}

/** Every token of the text, with its time, its offset and the words it stands for. */
export function alignTokens(
    text: string,
    words: readonly SourceWord[],
    segStartMs: number,
    segEndMs: number
): TokenAlignment[] {
    if (text === "") return [];

    const lo = segStartMs;
    const hi = Math.max(segStartMs, segEndMs);
    const pieces = tokenize(text).flatMap(splitNoSpaceRuns);

    if (pieces.length === 0) {
        return [{ text, startMs: lo, endMs: hi, offset: 0, wordFrom: 0, wordTo: 0 }];
    }

    // Matching runs over units; for space-separated text a unit is a word.
    const units = wordUnits(words);

    const times: Array<{ startMs: number; endMs: number }> = new Array(pieces.length);
    // Without alignment every token shares the whole word range.
    const spans: Array<[number, number]> = new Array(pieces.length).fill([0, units.length]);

    if (units.length === 0) {
        spread(pieces.length, lo, hi).forEach((t, i) => { times[i] = t; });
    } else if (pieces.length * words.length * words.length > MAX_ALIGNMENT_CELLS * units.length) {
        // pieces × units, both scaled from units to words (× words / units).
        spread(pieces.length, units[0].startMs, units[units.length - 1].endMs).forEach((t, i) => { times[i] = t; });
    } else {
        const anchors = matchAnchors(pieces.map(comparisonKey), units.map((u) => u.key));

        // Walk each stretch between anchors, plus the stretch after the last one.
        let prevToken = -1;
        let prevWord = -1;
        for (const [anchorToken, anchorWord] of [...anchors, [pieces.length, units.length] as [number, number]]) {
            const tokenCount = anchorToken - prevToken - 1;
            const wordCount = anchorWord - prevWord - 1;

            if (tokenCount > 0) {
                if (wordCount === tokenCount) {
                    // Corrected words: each token stands where its word was spoken.
                    for (let k = 0; k < tokenCount; k++) {
                        const w = units[prevWord + 1 + k];
                        times[prevToken + 1 + k] = { startMs: w.startMs, endMs: w.endMs };
                        spans[prevToken + 1 + k] = [prevWord + 1 + k, prevWord + 2 + k];
                    }
                } else {
                    // Rewritten tokens share their words; inserted ones have none.
                    for (let k = 0; k < tokenCount; k++) spans[prevToken + 1 + k] = [prevWord + 1, anchorWord];
                    let startMs: number;
                    let endMs: number;
                    if (wordCount > 0) {
                        // Rewritten words: share the window those words were spoken in.
                        startMs = units[prevWord + 1].startMs;
                        endMs = units[anchorWord - 1].endMs;
                    } else {
                        // Inserted words: fill the gap between the neighbouring anchors.
                        startMs = prevWord >= 0 ? units[prevWord].endMs : lo;
                        endMs = anchorWord < units.length ? units[anchorWord].startMs : hi;
                        // No gap (or overlapping words): zero-length, sharing the next
                        // anchor's start so that anchor keeps its exact time.
                        if (endMs <= startMs) startMs = endMs;
                    }
                    spread(tokenCount, startMs, endMs).forEach((t, k) => { times[prevToken + 1 + k] = t; });
                }
            }

            if (anchorToken < pieces.length) {
                const w = units[anchorWord];
                times[anchorToken] = { startMs: w.startMs, endMs: w.endMs };
                spans[anchorToken] = [anchorWord, anchorWord + 1];
            }
            prevToken = anchorToken;
            prevWord = anchorWord;
        }
    }

    // Unit ranges back to word ranges: a unit range covers the words its units
    // belong to; an empty one sits just before the word of its next unit.
    const wordRange = ([from, to]: [number, number]): [number, number] => {
        const wordFrom = from < units.length ? units[from].word : words.length;
        return to > from ? [wordFrom, units[to - 1].word + 1] : [wordFrom, wordFrom];
    };

    // Keep every time inside the segment, starts non-decreasing, and end >= start.
    let floor = lo;
    let offset = 0;
    const tokens = pieces.map((piece, i) => {
        const startMs = Math.min(hi, Math.max(floor, times[i].startMs));
        const endMs = Math.min(hi, Math.max(startMs, times[i].endMs));
        floor = startMs;
        const [wordFrom, wordTo] = wordRange(spans[i]);
        const token = { text: piece, startMs, endMs, offset, wordFrom, wordTo };
        offset += piece.length;
        return token;
    });
    return joinWordCharacters(tokens);
}

/**
 * Characters of a script written without spaces that stand for one and the same
 * word become one token for it again. Tokens with whitespace between them are
 * never joined, so space-separated text is untouched.
 */
function joinWordCharacters(tokens: TokenAlignment[]): TokenAlignment[] {
    const joined: TokenAlignment[] = [];
    for (const token of tokens) {
        const previous = joined[joined.length - 1];
        if (
            previous &&
            !/\s$/.test(previous.text) &&
            NO_SPACE_CHAR.test(previous.text) &&
            NO_SPACE_CHAR.test(token.text) &&
            token.wordTo - token.wordFrom === 1 &&
            previous.wordFrom === token.wordFrom &&
            previous.wordTo === token.wordTo
        ) {
            previous.text += token.text;
            previous.endMs = Math.max(previous.endMs, token.endMs);
        } else {
            joined.push({ ...token });
        }
    }
    return joined;
}
