/**
 * Line a segment's (possibly edited) text up against the words Deepgram heard.
 *
 * The stored words are a fixed record of the audio; the segment text is the
 * user's version. Every token of the text gets a time: tokens that still match
 * a word keep that word's exact timing, and everything else is a deterministic
 * estimate placed inside the time window it sits in. Aligning against the
 * original words every time means estimates never compound across edits.
 */

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

// Above this many LCS cells (a large paste), alignment is skipped and the
// tokens are spread evenly across the words' window instead.
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

export function alignTextToWords(
    text: string,
    words: readonly SourceWord[],
    segStartMs: number,
    segEndMs: number
): AlignedToken[] {
    if (text === "") return [];

    const lo = segStartMs;
    const hi = Math.max(segStartMs, segEndMs);
    const pieces = tokenize(text);

    if (pieces.length === 0) {
        return [{ text, startMs: lo, endMs: hi }];
    }

    const times: Array<{ startMs: number; endMs: number }> = new Array(pieces.length);

    if (words.length === 0) {
        spread(pieces.length, lo, hi).forEach((t, i) => { times[i] = t; });
    } else if (pieces.length * words.length > MAX_ALIGNMENT_CELLS) {
        spread(pieces.length, words[0].startMs, words[words.length - 1].endMs).forEach((t, i) => { times[i] = t; });
    } else {
        const anchors = matchAnchors(pieces.map(comparisonKey), words.map((w) => comparisonKey(w.text)));

        // Walk each stretch between anchors, plus the stretch after the last one.
        let prevToken = -1;
        let prevWord = -1;
        for (const [anchorToken, anchorWord] of [...anchors, [pieces.length, words.length] as [number, number]]) {
            const tokenCount = anchorToken - prevToken - 1;
            const wordCount = anchorWord - prevWord - 1;

            if (tokenCount > 0) {
                if (wordCount === tokenCount) {
                    // Corrected words: each token stands where its word was spoken.
                    for (let k = 0; k < tokenCount; k++) {
                        const w = words[prevWord + 1 + k];
                        times[prevToken + 1 + k] = { startMs: w.startMs, endMs: w.endMs };
                    }
                } else {
                    let startMs: number;
                    let endMs: number;
                    if (wordCount > 0) {
                        // Rewritten words: share the window those words were spoken in.
                        startMs = words[prevWord + 1].startMs;
                        endMs = words[anchorWord - 1].endMs;
                    } else {
                        // Inserted words: fill the gap between the neighbouring anchors.
                        startMs = prevWord >= 0 ? words[prevWord].endMs : lo;
                        endMs = anchorWord < words.length ? words[anchorWord].startMs : hi;
                        // No gap (or overlapping words): zero-length, sharing the next
                        // anchor's start so that anchor keeps its exact time.
                        if (endMs <= startMs) startMs = endMs;
                    }
                    spread(tokenCount, startMs, endMs).forEach((t, k) => { times[prevToken + 1 + k] = t; });
                }
            }

            if (anchorToken < pieces.length) {
                const w = words[anchorWord];
                times[anchorToken] = { startMs: w.startMs, endMs: w.endMs };
            }
            prevToken = anchorToken;
            prevWord = anchorWord;
        }
    }

    // Keep every time inside the segment, starts non-decreasing, and end >= start.
    let floor = lo;
    return pieces.map((piece, i) => {
        const startMs = Math.min(hi, Math.max(floor, times[i].startMs));
        const endMs = Math.min(hi, Math.max(startMs, times[i].endMs));
        floor = startMs;
        return { text: piece, startMs, endMs };
    });
}
