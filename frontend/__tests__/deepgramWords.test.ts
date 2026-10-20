import { DEFAULT_SEGMENT_BUILDER_CONFIG, buildSegments } from "@/core/transcript/segment-builder";
import { deepgramResultToWords, normalizeWords } from "@/core/transcription/engines/deepgram-words";
import { createRawWord } from "./helpers/deepgramWord";

describe("normalizeWords", () => {
    it("assigns paragraph indices and sentence ends from full paragraph metadata", () => {
        const words = [
            createRawWord({ text: "Hello", punctuatedText: "Hello", startMs: 0, endMs: 250, speaker: 0 }),
            createRawWord({ text: "there", punctuatedText: "there.", startMs: 260, endMs: 520, speaker: 0 }),
            createRawWord({ text: "Again", punctuatedText: "Again.", startMs: 1050, endMs: 1280, speaker: 0 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 0,
                    end: 0.55,
                    sentences: [{ text: "Hello there.", start: 0, end: 0.55 }],
                },
                {
                    speaker: 0,
                    start: 1.0,
                    end: 1.3,
                    sentences: [{ text: "Again.", start: 1.0, end: 1.3 }],
                },
            ],
        });

        expect(normalized.map((word) => word.paragraphIndex)).toEqual([0, 0, 1]);
        expect(normalized.map((word) => word.sentenceEnd)).toEqual([false, true, true]);
    });

    it("infers sentence ends from punctuation when paragraph metadata is null", () => {
        const words = [
            createRawWord({ text: "Hello", punctuatedText: "Hello", startMs: 0, endMs: 250 }),
            createRawWord({ text: "there", punctuatedText: "there.", startMs: 260, endMs: 520 }),
        ];

        const normalized = normalizeWords(words, null);

        expect(normalized.map((word) => word.paragraphIndex)).toEqual([null, null]);
        expect(normalized.map((word) => word.sentenceEnd)).toEqual([false, true]);
    });

    it("imputes intermittent missing speakers from the previous labeled word", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100, speaker: 1 }),
            createRawWord({ text: "two", startMs: 110, endMs: 200 }),
            createRawWord({ text: "three", startMs: 210, endMs: 300, speaker: 2 }),
            createRawWord({ text: "four", startMs: 310, endMs: 400 }),
        ];

        const normalized = normalizeWords(words, null);

        expect(normalized.map((word) => word.speaker)).toEqual([1, 1, 2, 2]);
    });

    it("keeps all speakers null when Deepgram provides no diarization", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100 }),
            createRawWord({ text: "two", startMs: 110, endMs: 200 }),
        ];

        const normalized = normalizeWords(words, null);
        expect(normalized.map((word) => word.speaker)).toEqual([null, null]);
    });

    it("inherits the previous paragraph index for words in timestamp gaps", () => {
        const words = [
            createRawWord({ text: "one", startMs: 0, endMs: 100, speaker: 0 }),
            createRawWord({ text: "gap", startMs: 500, endMs: 650, speaker: 0 }),
            createRawWord({ text: "two", startMs: 1100, endMs: 1200, speaker: 0 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 0,
                    end: 0.2,
                    sentences: [{ text: "one.", start: 0, end: 0.2 }],
                },
                {
                    speaker: 0,
                    start: 1.0,
                    end: 1.3,
                    sentences: [{ text: "two.", start: 1.0, end: 1.3 }],
                },
            ],
        });

        expect(normalized.map((word) => word.paragraphIndex)).toEqual([0, 0, 1]);
    });

    it("treats a Japanese comma like a comma, against a metadata sentence change", () => {
        const words = [
            createRawWord({ text: "今日は、", punctuatedText: "今日は、", startMs: 0, endMs: 200, speaker: 0 }),
            createRawWord({ text: "天気", punctuatedText: "天気", startMs: 1200, endMs: 1450, speaker: 0 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                { speaker: 0, start: 0, end: 0.22, sentences: [{ text: "今日は、", start: 0, end: 0.22 }] },
                { speaker: 0, start: 1.1, end: 1.5, sentences: [{ text: "天気", start: 1.1, end: 1.5 }] },
            ],
        });

        expect(normalized[0].sentenceEnd).toBe(false);
    });

    it("does not treat commas as sentence endings just because metadata says the sentence changed", () => {
        const words = [
            createRawWord({ text: "Hi", punctuatedText: "Hi,", startMs: 0, endMs: 200, speaker: 0 }),
            createRawWord({ text: "there", punctuatedText: "there", startMs: 260, endMs: 450, speaker: 0 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 0,
                    end: 0.22,
                    sentences: [{ text: "Hi,", start: 0, end: 0.22 }],
                },
                {
                    speaker: 0,
                    start: 0.23,
                    end: 0.5,
                    sentences: [{ text: "there", start: 0.23, end: 0.5 }],
                },
            ],
        });

        expect(normalized.map((word) => word.sentenceEnd)).toEqual([false, true]);
    });

    it("binds a sentence-initial word to the NEXT paragraph when paragraph boundaries abut exactly", () => {
        // Regression: Deepgram emits paragraph N end == paragraph N+1 start, and the
        // first word of the new sentence shares that timestamp (e.g. "We've" below).
        // Previously the word was assigned to paragraph N, which caused buildSegments
        // to break between "We've" and "said", orphaning "We've" at the end of the
        // previous segment. The fix is in matchTimedGroups — a word whose startMs
        // equals the next group's startMs must bind to the next group.
        const words = [
            createRawWord({ text: "is", punctuatedText: "is.", startMs: 156320, endMs: 156640, speaker: 0 }),
            createRawWord({ text: "we've", punctuatedText: "We've", startMs: 156640, endMs: 156880, speaker: 0 }),
            createRawWord({ text: "said", punctuatedText: "said", startMs: 156880, endMs: 157040, speaker: 0 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 151.68,
                    end: 156.64,
                    sentences: [
                        { text: "This purpose of this template is about this object, and we'll discuss what the object is.", start: 151.68, end: 156.64 },
                    ],
                },
                {
                    speaker: 0,
                    start: 156.64,
                    end: 171.145,
                    sentences: [
                        { text: "We've said tax codes, but there might be an issue with that.", start: 156.64, end: 159.145 },
                    ],
                },
            ],
        });

        expect(normalized.map((word) => word.paragraphIndex)).toEqual([0, 1, 1]);
        // "is." is sentence-terminal via punctuation; "We've" must NOT be (no
        // punctuation and its sentence continues with "said"). The last-word
        // sentenceEnd flag is tail-of-transcript noise and not asserted here.
        expect(normalized[0].sentenceEnd).toBe(true);
        expect(normalized[1].sentenceEnd).toBe(false);

        const segments = buildSegments(normalized);
        expect(segments).toHaveLength(2);
        expect(segments[0].words.map((word) => word.punctuatedText)).toEqual(["is."]);
        expect(segments[1].words.map((word) => word.punctuatedText)).toEqual(["We've", "said"]);
    });

    it("still allows Deepgram metadata to mark a boundary when a large pause supports it", () => {
        const words = [
            createRawWord({ text: "hello", punctuatedText: "hello", startMs: 0, endMs: 250, speaker: 0 }),
            createRawWord({ text: "again", punctuatedText: "again", startMs: 1400, endMs: 1700, speaker: 0 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                {
                    speaker: 0,
                    start: 0,
                    end: 0.3,
                    sentences: [{ text: "hello", start: 0, end: 0.3 }],
                },
                {
                    speaker: 0,
                    start: 1.35,
                    end: 1.75,
                    sentences: [{ text: "again", start: 1.35, end: 1.75 }],
                },
            ],
        });

        expect(normalized.map((word) => word.sentenceEnd)).toEqual([true, true]);
    });
});

describe("without speaker detection", () => {
    it("builds segments with no speaker from paragraphs that name none", () => {
        const words = [
            createRawWord({ text: "Hello", punctuatedText: "Hello", startMs: 0, endMs: 250 }),
            createRawWord({ text: "there", punctuatedText: "there.", startMs: 260, endMs: 520 }),
            createRawWord({ text: "Again", punctuatedText: "Again.", startMs: 1050, endMs: 1280 }),
        ];

        const normalized = normalizeWords(words, {
            paragraphs: [
                { start: 0, end: 0.55, sentences: [{ text: "Hello there.", start: 0, end: 0.55 }] },
                { start: 1.0, end: 1.3, sentences: [{ text: "Again.", start: 1.0, end: 1.3 }] },
            ],
        });
        const segments = buildSegments(normalized, DEFAULT_SEGMENT_BUILDER_CONFIG);

        expect(normalized.map((word) => word.paragraphIndex)).toEqual([0, 0, 1]);
        expect(normalized.every((word) => word.speaker === null)).toBe(true);
        expect(segments.length).toBeGreaterThan(0);
        expect(segments.every((segment) => segment.speakerNum === null)).toBe(true);
    });
});

describe("deepgramResultToWords spacing", () => {
    it("never joins English words, even when a word is found only inside a longer one", () => {
        // "Dr." is not in the transcript, and "a" is first found inside "banana",
        // right before "nana": the search must not glue "nana" to "a".
        const raw = JSON.stringify({
            results: {
                channels: [{
                    alternatives: [{
                        transcript: "Doctor banana split.",
                        words: [
                            createRawWord({ text: "dr", punctuatedText: "Dr.", startMs: 0, endMs: 200 }),
                            createRawWord({ text: "a", punctuatedText: "a", startMs: 200, endMs: 300 }),
                            createRawWord({ text: "nana", punctuatedText: "nana", startMs: 300, endMs: 500 }),
                            createRawWord({ text: "split", punctuatedText: "split.", startMs: 500, endMs: 800 }),
                        ],
                    }],
                }],
            },
        });

        const { words } = deepgramResultToWords(raw);

        expect(words.map((word) => word.joinsPrevious ?? false)).toEqual([false, false, false, false]);
    });
});
