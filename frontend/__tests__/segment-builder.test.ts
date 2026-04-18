import type { DeepgramWord } from "@/contracts/webhook";
import {
    DEFAULT_CONFIG,
    consolidateSegments,
    type SegmentData,
} from "@/core/transcript/consolidation";
import {
    DEFAULT_SEGMENT_BUILDER_CONFIG,
    buildSegments,
    normalizeWords,
} from "@/core/transcript/segment-builder";
import { normalizeText } from "@/core/transcript/text-utils";

function createRawWord({
    text,
    startMs,
    endMs,
    punctuatedText,
    speaker,
    speakerConfidence,
}: {
    text: string;
    startMs: number;
    endMs: number;
    punctuatedText?: string;
    speaker?: number;
    speakerConfidence?: number;
}): DeepgramWord {
    return {
        word: text,
        start: startMs / 1000,
        end: endMs / 1000,
        confidence: 0.99,
        ...(punctuatedText ? { punctuated_word: punctuatedText } : {}),
        ...(speaker !== undefined ? { speaker } : {}),
        ...(speakerConfidence !== undefined ? { speaker_confidence: speakerConfidence } : {}),
    };
}

function currentStyleSpeakerRuns(words: DeepgramWord[]): SegmentData[] {
    if (words.length === 0) {
        return [];
    }

    const hasSpeakerInfo = words.some((word) => typeof word.speaker === "number");
    const runs: DeepgramWord[][] = [];

    if (!hasSpeakerInfo) {
        runs.push(words);
    } else {
        let currentRun: DeepgramWord[] = [words[0]];
        let lastSpeaker = words[0].speaker;

        for (let index = 1; index < words.length; index++) {
            const speaker = words[index].speaker;
            if (typeof speaker === "number" && speaker !== lastSpeaker) {
                runs.push(currentRun);
                currentRun = [words[index]];
                lastSpeaker = speaker;
            } else {
                currentRun.push(words[index]);
            }
        }

        runs.push(currentRun);
    }

    return runs.map((run, index) => ({
        id: `run-${index}`,
        speakerId: typeof run[0].speaker === "number" ? `speaker-${run[0].speaker}` : null,
        startMs: Math.round(run[0].start * 1000),
        endMs: Math.round(run[run.length - 1].end * 1000),
        text: run.map((word) => word.punctuated_word ?? word.word).join(" "),
        wordIds: [],
    }));
}

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

    it("matches the current no-paragraph behavior on speaker-driven breaks", () => {
        const words = [
            createRawWord({ text: "Hello", punctuatedText: "Hello.", startMs: 0, endMs: 200, speaker: 0 }),
            createRawWord({ text: "again", punctuatedText: "again.", startMs: 250, endMs: 450, speaker: 0 }),
            createRawWord({ text: "next", punctuatedText: "next.", startMs: 500, endMs: 700, speaker: 1 }),
            createRawWord({ text: "speaker", punctuatedText: "speaker.", startMs: 750, endMs: 950, speaker: 1 }),
        ];

        const builtSegments = buildSegments(normalizeWords(words, null)).map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
        }));

        const consolidated = consolidateSegments(currentStyleSpeakerRuns(words), DEFAULT_CONFIG)
            .map((chunk) => ({
                startMs: chunk.startMs,
                endMs: chunk.endMs,
                text: normalizeText(chunk.texts),
            }));

        expect(builtSegments).toEqual(consolidated);
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
