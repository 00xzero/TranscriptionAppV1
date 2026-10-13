import { findSplit } from "@/core/transcript/segment-split";
import { MAX_ALIGNMENT_CELLS, alignTokens, type SourceWord } from "@/core/transcript/word-alignment";

function w(text: string, startMs: number, endMs: number): SourceWord {
    return { text, startMs, endMs };
}

function split(text: string, words: SourceWord[], caret: number, segStartMs = words[0]?.startMs ?? 0) {
    const segEndMs = words.length ? words[words.length - 1].endMs : 0;
    return findSplit(alignTokens(text, words, segStartMs, segEndMs), words, text, caret, segStartMs);
}

const GREETING = [
    w("Hello", 0, 400),
    w("there.", 400, 800),
    w("How", 1000, 1200),
    w("are", 1200, 1400),
    w("you?", 1400, 1800),
];
const GREETING_TEXT = "Hello there. How are you?";

describe("findSplit", () => {
    it("splits untouched text exactly at every gap between words", () => {
        // Caret at the start of each later word.
        expect(split(GREETING_TEXT, GREETING, 6)).toEqual({ firstText: "Hello", secondText: "there. How are you?", splitWordIndex: 1 });
        expect(split(GREETING_TEXT, GREETING, 13)).toEqual({ firstText: "Hello there.", secondText: "How are you?", splitWordIndex: 2 });
        expect(split(GREETING_TEXT, GREETING, 17)).toEqual({ firstText: "Hello there. How", secondText: "are you?", splitWordIndex: 3 });
        expect(split(GREETING_TEXT, GREETING, 21)).toEqual({ firstText: "Hello there. How are", secondText: "you?", splitWordIndex: 4 });
    });

    it("breaks before the next word when the caret is in the space after a word", () => {
        expect(split(GREETING_TEXT, GREETING, 12)?.splitWordIndex).toBe(2);
        expect(split("Hello   there. How are you?", GREETING, 7)).toEqual({
            firstText: "Hello", secondText: "there. How are you?", splitWordIndex: 1,
        });
    });

    it("snaps a caret inside a word to that word's nearer edge", () => {
        // "How" spans offsets 13-16.
        expect(split(GREETING_TEXT, GREETING, 14)?.splitWordIndex).toBe(2);
        expect(split(GREETING_TEXT, GREETING, 15)?.splitWordIndex).toBe(3);
    });

    it("has no split at the very start or end", () => {
        expect(split(GREETING_TEXT, GREETING, 0)).toBeNull();
        expect(split(GREETING_TEXT, GREETING, 1)).toBeNull();
        expect(split(GREETING_TEXT, GREETING, GREETING_TEXT.length)).toBeNull();
        expect(split(GREETING_TEXT, GREETING, GREETING_TEXT.length - 1)).toBeNull();
        expect(split("  " + GREETING_TEXT, GREETING, 1)).toBeNull();
    });

    it("treats a line break like any other space", () => {
        expect(split("Hello there.\nHow are you?", GREETING, 12)).toEqual({
            firstText: "Hello there.", secondText: "How are you?", splitWordIndex: 2,
        });
    });

    it("cuts one-for-one corrections exactly", () => {
        const words = [w("I", 0, 200), w("saw", 200, 500), w("their", 500, 800), w("car.", 800, 1200)];
        expect(split("I saw there car.", words, 6)?.splitWordIndex).toBe(2);
        expect(split("I saw there car.", words, 12)?.splitWordIndex).toBe(3);
    });

    describe("inside a phrase rewritten into a different number of words", () => {
        const words = [
            w("the", 0, 200),
            w("quarterly", 200, 600),
            w("numbers", 600, 1000),
            w("were", 1000, 1200),
            w("pretty", 1200, 1500),
            w("bad", 1500, 1800),
            w("honestly", 1800, 2200),
        ];
        const text = "the Q3 results disappointed us honestly";

        it("divides the spoken words by estimated time", () => {
            // The four new words spread over 200-1800, so "disappointed" starts
            // at 1000: words whose midpoint comes earlier stay.
            expect(split(text, words, text.indexOf("disappointed"))).toEqual({
                firstText: "the Q3 results", secondText: "disappointed us honestly", splitWordIndex: 3,
            });
        });

        it("moves the whole stretch when the break is at its edge", () => {
            expect(split(text, words, text.indexOf("Q3"))?.splitWordIndex).toBe(1);
            expect(split(text, words, text.indexOf("honestly"))?.splitWordIndex).toBe(6);
        });
    });

    it("keeps deleted words with the first half", () => {
        const words = [w("we", 0, 200), w("should", 200, 400), w("um", 400, 600), w("probably", 600, 900), w("move", 900, 1100), w("on", 1100, 1300)];
        expect(split("we should move on", words, 10)?.splitWordIndex).toBe(4);
    });

    it("has no split where a half would get no spoken word", () => {
        const words = [w("Hello", 0, 400), w("there", 400, 800)];
        // Typed in before anything Deepgram heard.
        expect(split("Well okay Hello there", words, 5)).toBeNull();
        expect(split("Well okay Hello there", words, 10)).toBeNull();
        expect(split("Well okay Hello there", words, 16)).toEqual({
            firstText: "Well okay Hello", secondText: "there", splitWordIndex: 1,
        });
        // Typed in after.
        expect(split("Hello there and more", words, 12)).toBeNull();
    });

    it("has no split without at least two words", () => {
        expect(split("Hello there", [], 6)).toBeNull();
        expect(split("Hello there", [w("Hello", 0, 400)], 6)).toBeNull();
    });

    it("has no split where the new segment would not start after this one", () => {
        const words = [w("a", 1000, 1000), w("b", 1000, 1200), w("c", 1200, 1400)];
        expect(split("a b c", words, 2, 1000)).toBeNull();
        expect(split("a b c", words, 4, 1000)?.splitWordIndex).toBe(2);
    });

    it("still splits a text too long to align, by time", () => {
        const words = Array.from({ length: 300 }, (_, i) => w(`word${i}`, i * 100, i * 100 + 100));
        const tokens = Array.from({ length: 200 }, (_, i) => `typed${i}`);
        expect(tokens.length * words.length).toBeGreaterThan(MAX_ALIGNMENT_CELLS);
        const text = tokens.join(" ");
        // 200 tokens spread over 0-30000ms: token 100 starts at 15000.
        expect(split(text, words, text.indexOf("typed100"))?.splitWordIndex).toBe(150);
    });
});
