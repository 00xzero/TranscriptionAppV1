import {
    MAX_ALIGNMENT_CELLS,
    alignTextToWords,
    alignTokens,
    type AlignedToken,
    type SourceWord,
} from "@/core/transcript/word-alignment";

function w(text: string, startMs: number, endMs: number): SourceWord {
    return { text, startMs, endMs };
}

/** [text, startMs, endMs] per token, for compact exact assertions. */
function triples(tokens: AlignedToken[]): Array<[string, number, number]> {
    return tokens.map((t) => [t.text, t.startMs, t.endMs]);
}

function align(text: string, words: SourceWord[], segStartMs: number, segEndMs: number) {
    const tokens = alignTextToWords(text, words, segStartMs, segEndMs);
    // The card's search highlighting counts characters across tokens.
    if (text !== "") expect(tokens.map((t) => t.text).join("")).toBe(text);
    return tokens;
}

const GREETING = [
    w("Hello", 0, 400),
    w("there.", 400, 800),
    w("How", 1000, 1200),
    w("are", 1200, 1400),
    w("you?", 1400, 1800),
];

describe("alignTextToWords", () => {
    it("gives unchanged text the exact word timings", () => {
        expect(triples(align("Hello there. How are you?", GREETING, 0, 1800))).toEqual([
            ["Hello ", 0, 400],
            ["there. ", 400, 800],
            ["How ", 1000, 1200],
            ["are ", 1200, 1400],
            ["you?", 1400, 1800],
        ]);
    });

    it("keeps exact timings through case and punctuation changes", () => {
        expect(triples(align("hello there, how are you", GREETING, 0, 1800))).toEqual([
            ["hello ", 0, 400],
            ["there, ", 400, 800],
            ["how ", 1000, 1200],
            ["are ", 1200, 1400],
            ["you", 1400, 1800],
        ]);
    });

    it("gives a corrected word the timing of the word it replaced", () => {
        const words = [w("I", 0, 200), w("saw", 200, 500), w("their", 500, 800), w("car.", 800, 1200)];
        expect(triples(align("I saw there car.", words, 0, 1200))).toEqual([
            ["I ", 0, 200],
            ["saw ", 200, 500],
            ["there ", 500, 800],
            ["car.", 800, 1200],
        ]);
    });

    it("places an inserted word in the gap between its neighbours", () => {
        const words = [w("I", 0, 200), w("think", 500, 800)];
        expect(triples(align("I really think", words, 0, 800))).toEqual([
            ["I ", 0, 200],
            ["really ", 200, 500],
            ["think", 500, 800],
        ]);
        expect(triples(align("I really truly think", words, 0, 800))).toEqual([
            ["I ", 0, 200],
            ["really ", 200, 350],
            ["truly ", 350, 500],
            ["think", 500, 800],
        ]);
    });

    it("gives words inserted into a zero-length gap the next word's start time", () => {
        const words = [w("I", 0, 200), w("think", 200, 500)];
        expect(triples(align("I really think", words, 0, 500))).toEqual([
            ["I ", 0, 200],
            ["really ", 200, 200],
            ["think", 200, 500],
        ]);
    });

    it("keeps the next word's exact start when its neighbours overlap", () => {
        const words = [w("a", 0, 300), w("b", 250, 400)];
        expect(triples(align("a x b", words, 0, 400))).toEqual([
            ["a ", 0, 300],
            ["x ", 250, 250],
            ["b", 250, 400],
        ]);
    });

    it("places inserted words at the segment edges", () => {
        const words = [w("think", 300, 500)];
        expect(triples(align("I think", words, 0, 500))).toEqual([
            ["I ", 0, 300],
            ["think", 300, 500],
        ]);
        expect(triples(align("think so", words, 0, 500))).toEqual([
            ["think ", 300, 500],
            ["so", 500, 500],
        ]);
    });

    it("shares one word's window when it is rewritten as several", () => {
        const words = [w("I'm", 0, 300), w("gonna", 300, 600), w("go.", 600, 900)];
        expect(triples(align("I'm going to go.", words, 0, 900))).toEqual([
            ["I'm ", 0, 300],
            ["going ", 300, 450],
            ["to ", 450, 600],
            ["go.", 600, 900],
        ]);
    });

    it("drops deleted words", () => {
        expect(triples(align("Hello how are you?", GREETING, 0, 1800))).toEqual([
            ["Hello ", 0, 400],
            ["how ", 1000, 1200],
            ["are ", 1200, 1400],
            ["you?", 1400, 1800],
        ]);
    });

    it("keeps the earliest matching word when a repeated word is removed", () => {
        const words = [w("we", 0, 100), w("can", 100, 300), w("can", 300, 500), w("go", 500, 700)];
        expect(triples(align("we can go", words, 0, 700))).toEqual([
            ["we ", 0, 100],
            ["can ", 100, 300],
            ["go", 500, 700],
        ]);
    });

    it("estimates a full rewrite across the words it replaced", () => {
        const words = [w("a", 0, 100), w("b", 100, 200), w("c", 200, 300)];
        expect(triples(align("x y", words, 0, 300))).toEqual([
            ["x ", 0, 150],
            ["y", 150, 300],
        ]);
        expect(triples(align("x y z", words, 0, 300))).toEqual([
            ["x ", 0, 100],
            ["y ", 100, 200],
            ["z", 200, 300],
        ]);
    });

    it("spreads tokens evenly across the segment when there are no words", () => {
        expect(triples(align("one two three four", [], 1000, 2000))).toEqual([
            ["one ", 1000, 1250],
            ["two ", 1250, 1500],
            ["three ", 1500, 1750],
            ["four", 1750, 2000],
        ]);
    });

    it("covers whitespace-only text with one token and returns nothing for empty text", () => {
        expect(triples(align("   ", GREETING, 0, 1800))).toEqual([["   ", 0, 1800]]);
        expect(alignTextToWords("", GREETING, 0, 1800)).toEqual([]);
    });

    it("keeps leading, trailing and doubled whitespace on the tokens", () => {
        expect(triples(align("  Hello  there.  ", GREETING.slice(0, 2), 0, 800))).toEqual([
            ["  Hello  ", 0, 400],
            ["there.  ", 400, 800],
        ]);
        expect(triples(align("Hello\nthere.", GREETING.slice(0, 2), 0, 800))).toEqual([
            ["Hello\n", 0, 400],
            ["there.", 400, 800],
        ]);
    });

    it("never treats punctuation-only tokens as matches", () => {
        const words = [w("yes", 0, 200), w("no", 300, 500)];
        expect(triples(align("yes — no", words, 0, 500))).toEqual([
            ["yes ", 0, 200],
            ["— ", 200, 300],
            ["no", 300, 500],
        ]);
    });

    it("clamps times to the segment and keeps starts in order", () => {
        const words = [w("a", 50, 150), w("b", 450, 600)];
        expect(triples(align("a b", words, 100, 500))).toEqual([
            ["a ", 100, 150],
            ["b", 450, 500],
        ]);
    });

    it("skips matching for very large inputs and spreads across the words' window", () => {
        const words = Array.from({ length: 201 }, (_, i) => w(`w${i}`, i * 100, i * 100 + 100));
        const text = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
        expect(200 * 201).toBeGreaterThan(MAX_ALIGNMENT_CELLS);

        const tokens = align(text, words, 0, 20100);
        expect(tokens).toHaveLength(200);
        // Matching would have given token 1 word 1's exact 100ms start.
        expect(tokens[0].startMs).toBe(0);
        expect(tokens[1].startMs).toBe(101);
        expect(tokens[199].endMs).toBe(20100);
    });
});

describe("alignTokens", () => {
    /** [text, offset, wordFrom, wordTo] per token. */
    function spans(text: string, words: SourceWord[]) {
        return alignTokens(text, words, 0, 2000).map((t) => [t.text, t.offset, t.wordFrom, t.wordTo]);
    }

    it("gives each token its offset and the word it matched or corrected", () => {
        expect(spans("I saw there car.", [w("I", 0, 200), w("saw", 200, 500), w("their", 500, 800), w("car.", 800, 1200)])).toEqual([
            ["I ", 0, 0, 1],
            ["saw ", 2, 1, 2],
            ["there ", 6, 2, 3],
            ["car.", 12, 3, 4],
        ]);
    });

    it("lets a rewritten stretch share its words and gives typed-in words none", () => {
        const words = [w("so", 0, 100), w("gonna", 100, 400), w("go", 400, 600)];
        expect(spans("so going to go", words)).toEqual([
            ["so ", 0, 0, 1],
            ["going ", 3, 1, 2],
            ["to ", 9, 1, 2],
            ["go", 12, 2, 3],
        ]);
        expect(spans("well so go", [w("so", 0, 100), w("go", 400, 600)])).toEqual([
            ["well ", 0, 0, 0],
            ["so ", 5, 0, 1],
            ["go", 8, 1, 2],
        ]);
    });

    it("matches alignTextToWords' times", () => {
        const text = "Hello there, how are you";
        expect(alignTokens(text, GREETING, 0, 1800).map(({ text: t, startMs, endMs }) => ({ text: t, startMs, endMs })))
            .toEqual(alignTextToWords(text, GREETING, 0, 1800));
    });
});
