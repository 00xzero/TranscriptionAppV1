import {
    DEFAULT_SEGMENT_BUILDER_CONFIG,
    buildSegments,
} from "@/core/transcript/segment-builder";
// Deepgram words are the handiest way to describe input; the cases here are
// about segmenting, and normalizeWords has its own tests in deepgramWords.test.ts.
import { normalizeWords } from "@/core/transcription/engines/deepgram-words";
import { createRawWord } from "./helpers/deepgramWord";

describe("buildSegments", () => {
    it("returns an empty array for empty input", () => {
        expect(buildSegments([])).toEqual([]);
    });

    it("breaks a single-speaker monologue on a sentence boundary near 60 words", () => {
        const words = Array.from({ length: 61 }, (_, index) =>
            createRawWord({
                text: `word${index + 1}`,
                punctuatedText: index === 59 ? `word${index + 1}.` : `word${index + 1}`,
                startMs: index * 100,
                endMs: index * 100 + 80,
                speaker: 0,
            })
        );

        const segments = buildSegments(normalizeWords(words, null));

        expect(segments).toHaveLength(2);
        expect(segments[0].words).toHaveLength(60);
        expect(segments[1].words).toHaveLength(1);
    });

    it("breaks on paragraph boundaries even when the speaker is unchanged", () => {
        const words = [
            createRawWord({ text: "First", punctuatedText: "First.", startMs: 0, endMs: 200, speaker: 0 }),
            createRawWord({ text: "Second", punctuatedText: "Second.", startMs: 900, endMs: 1100, speaker: 0 }),
        ];

        const segments = buildSegments(normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 0,
                    end: 0.3,
                    sentences: [{ text: "First.", start: 0, end: 0.3 }],
                },
                {
                    speaker: 0,
                    start: 0.85,
                    end: 1.2,
                    sentences: [{ text: "Second.", start: 0.85, end: 1.2 }],
                },
            ],
        }));

        expect(segments).toHaveLength(2);
        expect(segments.map((segment) => segment.text)).toEqual(["First.", "Second."]);
    });

    it("breaks on every speaker change during rapid alternation", () => {
        const words = [
            createRawWord({ text: "a", startMs: 0, endMs: 100, speaker: 0 }),
            createRawWord({ text: "b", startMs: 110, endMs: 200, speaker: 1 }),
            createRawWord({ text: "c", startMs: 210, endMs: 300, speaker: 0 }),
            createRawWord({ text: "d", startMs: 310, endMs: 400, speaker: 1 }),
        ];

        const segments = buildSegments(normalizeWords(words, null));

        expect(segments).toHaveLength(4);
        expect(segments.map((segment) => segment.speakerNum)).toEqual([0, 1, 0, 1]);
    });

    it("respects speaker changes separately from paragraph boundaries", () => {
        const words = [
            createRawWord({ text: "one", punctuatedText: "one.", startMs: 0, endMs: 150, speaker: 0 }),
            createRawWord({ text: "two", punctuatedText: "two.", startMs: 200, endMs: 350, speaker: 1 }),
            createRawWord({ text: "three", punctuatedText: "three.", startMs: 900, endMs: 1050, speaker: 1 }),
        ];

        const segments = buildSegments(normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 0,
                    end: 0.45,
                    sentences: [
                        { text: "one.", start: 0, end: 0.2 },
                        { text: "two.", start: 0.2, end: 0.45 },
                    ],
                },
                {
                    speaker: 1,
                    start: 0.85,
                    end: 1.1,
                    sentences: [{ text: "three.", start: 0.85, end: 1.1 }],
                },
            ],
        }));

        expect(segments).toHaveLength(3);
        expect(segments.map((segment) => segment.speakerNum)).toEqual([0, 1, 1]);
        expect(segments.map((segment) => segment.text)).toEqual(["one.", "two.", "three."]);
    });

    it("breaks on silence gaps larger than 2000ms", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100, speaker: 0 }),
            createRawWord({ text: "two", startMs: 2501, endMs: 2600, speaker: 0 }),
        ];

        const segments = buildSegments(normalizeWords(words, null));
        expect(segments).toHaveLength(2);
    });

    it("lets a segment run past the soft max duration until the sentence ends", () => {
        const words = [
            createRawWord({ text: "one", punctuatedText: "one", startMs: 0, endMs: 7000, speaker: 0 }),
            createRawWord({ text: "two", punctuatedText: "two", startMs: 7100, endMs: 15050, speaker: 0 }),
            createRawWord({ text: "three", punctuatedText: "three.", startMs: 15100, endMs: 18000, speaker: 0 }),
            createRawWord({ text: "next", punctuatedText: "next.", startMs: 18100, endMs: 18400, speaker: 0 }),
        ];

        const segments = buildSegments(normalizeWords(words, null));

        expect(segments).toHaveLength(2);
        expect(segments[0].text).toBe("one two three.");
        expect(segments[0].endMs).toBe(18000);
        expect(segments[1].text).toBe("next.");
    });

    it("prefers a sentence boundary after the target word count instead of breaking exactly at 60", () => {
        const words = Array.from({ length: 62 }, (_, index) =>
            createRawWord({
                text: `word${index + 1}`,
                punctuatedText: index === 60 ? `word${index + 1}.` : `word${index + 1}`,
                startMs: index * 100,
                endMs: index * 100 + 80,
                speaker: 0,
            })
        );

        const segments = buildSegments(normalizeWords(words, null));

        expect(segments).toHaveLength(2);
        expect(segments[0].words).toHaveLength(61);
        expect(segments[1].words).toHaveLength(1);
    });

    it("marks short filler segments using the shared filler logic", () => {
        const words = [
            createRawWord({ text: "Yeah", punctuatedText: "Yeah.", startMs: 0, endMs: 100, speaker: 0 }),
        ];

        const segments = buildSegments(normalizeWords(words, null));
        expect(segments[0].isFiller).toBe(true);
    });

    it("respects custom config overrides", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100, speaker: 0 }),
            createRawWord({ text: "two", startMs: 250, endMs: 350, speaker: 0 }),
        ];

        const segments = buildSegments(normalizeWords(words, null), {
            ...DEFAULT_SEGMENT_BUILDER_CONFIG,
            maxGapMs: 50,
        });

        expect(segments).toHaveLength(2);
    });

    it("still falls back to a hard cut when a sentence runs far past the soft caps", () => {
        const words = Array.from({ length: 5 }, (_, index) =>
            createRawWord({
                text: `word${index + 1}`,
                punctuatedText: `word${index + 1}`,
                startMs: index * 6000,
                endMs: index * 6000 + 5500,
                speaker: 0,
            })
        );

        const segments = buildSegments(normalizeWords(words, null), {
            ...DEFAULT_SEGMENT_BUILDER_CONFIG,
            maxDurationMs: 10000,
            maxDurationOverrunMs: 5000,
        });

        expect(segments).toHaveLength(2);
        expect(segments[0].words).toHaveLength(3);
        expect(segments[1].words).toHaveLength(2);
    });

    it("returns speaker-homogeneous segments", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100 }),
            createRawWord({ text: "two", startMs: 110, endMs: 200 }),
            createRawWord({ text: "three", startMs: 210, endMs: 300, speaker: 1 }),
            createRawWord({ text: "four", startMs: 310, endMs: 400 }),
            createRawWord({ text: "five", startMs: 410, endMs: 500, speaker: 2 }),
        ];

        const segments = buildSegments(normalizeWords(words, null));

        for (const segment of segments) {
            expect(new Set(segment.words.map((word) => word.speaker)).size).toBe(1);
        }
    });

    it("starts a new segment when leading null-speaker words are followed by a labeled speaker", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100 }),
            createRawWord({ text: "two", startMs: 110, endMs: 200 }),
            createRawWord({ text: "three", startMs: 210, endMs: 300, speaker: 1 }),
            createRawWord({ text: "four", startMs: 310, endMs: 400 }),
        ];

        const segments = buildSegments(normalizeWords(words, null));

        expect(segments).toHaveLength(2);
        expect(segments.map((segment) => segment.speakerNum)).toEqual([null, 1]);
        expect(segments[0].words).toHaveLength(2);
        expect(segments[1].words).toHaveLength(2);
    });

    it("does not emit an empty segment when a sentence split is followed by a speaker change", () => {
        const words = [
            createRawWord({ text: "one", punctuatedText: "one", startMs: 0, endMs: 100, speaker: 0 }),
            createRawWord({ text: "two", punctuatedText: "two.", startMs: 110, endMs: 200, speaker: 0 }),
            createRawWord({ text: "three", punctuatedText: "three.", startMs: 210, endMs: 300, speaker: 1 }),
        ];

        const segments = buildSegments(normalizeWords(words, null), {
            ...DEFAULT_SEGMENT_BUILDER_CONFIG,
            targetWords: 2,
        });

        expect(segments).toHaveLength(2);
        expect(segments.map((segment) => segment.text)).toEqual(["one two.", "three."]);
        expect(segments.every((segment) => segment.words.length > 0)).toBe(true);
    });
});
