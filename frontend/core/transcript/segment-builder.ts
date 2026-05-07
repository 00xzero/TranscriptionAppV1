import type { DeepgramWord } from "@/contracts/webhook";
import {
    DEFAULT_FILLER_PATTERNS,
    getWordCount,
    isFiller,
    isSentenceBoundary,
    normalizeText,
} from "@/core/transcript/text-utils";

const TIMESTAMP_TOLERANCE_MS = 50;
const METADATA_SENTENCE_GAP_MS = 800;

export interface NormalizedWord {
    text: string;
    punctuatedText: string;
    startMs: number;
    endMs: number;
    confidence: number;
    speaker: number | null;
    speakerConfidence: number | null;
    paragraphIndex: number | null;
    sentenceEnd: boolean;
}

export interface ParagraphMetadata {
    paragraphs: Array<{
        speaker: number;
        start: number;
        end: number;
        sentences: Array<{
            text: string;
            start: number;
            end: number;
        }>;
    }>;
}

export interface SegmentBuilderConfig {
    targetWords: number;
    maxGapMs: number;
    maxDurationMs: number;
    maxWordOverrun: number;
    maxDurationOverrunMs: number;
    minAbsorbWords: number;
    fillerPatterns: string[];
    algoVersion: string;
}

export interface BuiltSegment {
    speakerNum: number | null;
    startMs: number;
    endMs: number;
    text: string;
    words: NormalizedWord[];
    isFiller: boolean;
    algoVersion: string;
}

interface TimedGroup {
    index: number;
    startMs: number;
    endMs: number;
}

export const DEFAULT_SEGMENT_BUILDER_CONFIG: SegmentBuilderConfig = {
    targetWords: 60,
    maxGapMs: 2000,
    maxDurationMs: 15000,
    maxWordOverrun: 40,
    maxDurationOverrunMs: 10000,
    minAbsorbWords: 3,
    fillerPatterns: [...DEFAULT_FILLER_PATTERNS],
    algoVersion: "v2.0-segments",
};

function inferSentenceEndFromMetadataHint(
    word: Pick<NormalizedWord, "punctuatedText" | "endMs" | "paragraphIndex">,
    nextWord: Pick<NormalizedWord, "startMs" | "paragraphIndex" | "speaker"> | undefined,
    metadataSentenceBoundary: boolean
): boolean {
    if (isSentenceBoundary(word.punctuatedText)) {
        return true;
    }

    // Explicit non-terminal punctuation (comma, semicolon, colon, dash) is strong
    // counter-evidence to any metadata-based sentence boundary signal. Deepgram
    // occasionally splits paragraphs mid-clause at a comma; trust the punctuation.
    if (/[,;:\-]$/.test(word.punctuatedText.trimEnd())) {
        return false;
    }

    if (!metadataSentenceBoundary) {
        return false;
    }

    if (!nextWord) {
        return true;
    }

    const gapMs = nextWord.startMs - word.endMs;
    const paragraphChanged = (
        word.paragraphIndex !== null &&
        nextWord.paragraphIndex !== null &&
        word.paragraphIndex !== nextWord.paragraphIndex
    );

    // Deepgram sentence boundaries can be noisy, so only trust them when a
    // stronger structural cue also exists.
    return paragraphChanged || gapMs >= METADATA_SENTENCE_GAP_MS;
}

function toMs(seconds: number): number {
    return Math.round(seconds * 1000);
}

function matchTimedGroups(
    words: Array<Pick<NormalizedWord, "startMs">>,
    groups: TimedGroup[]
): Array<number | null> {
    if (groups.length === 0) {
        return words.map(() => null);
    }

    let groupCursor = 0;
    let lastMatchedIndex: number | null = null;

    return words.map((word) => {
        // Advance the cursor whenever the word reaches the next group's start.
        // Deepgram's paragraph/sentence ranges often abut exactly
        // (paragraph N `end` == paragraph N+1 `start`), so a sentence-initial
        // word whose `startMs` equals that boundary must bind to the NEXT group,
        // otherwise it gets orphaned at the tail of the previous paragraph
        // and the segment builder cuts the segment mid-sentence.
        while (
            groupCursor < groups.length - 1 &&
            word.startMs >= groups[groupCursor + 1].startMs - TIMESTAMP_TOLERANCE_MS
        ) {
            groupCursor++;
        }

        const currentGroup = groups[groupCursor];
        if (!currentGroup) {
            return lastMatchedIndex;
        }

        if (word.startMs < currentGroup.startMs - TIMESTAMP_TOLERANCE_MS) {
            return lastMatchedIndex;
        }

        if (word.startMs <= currentGroup.endMs + TIMESTAMP_TOLERANCE_MS) {
            lastMatchedIndex = currentGroup.index;
            return currentGroup.index;
        }

        return lastMatchedIndex;
    });
}

export function normalizeWords(
    rawWords: DeepgramWord[],
    paragraphs: ParagraphMetadata | null
): NormalizedWord[] {
    const hasDiarization = rawWords.some((word) => typeof word.speaker === "number");
    let lastSpeaker: number | null = null;

    const normalized = rawWords.map<NormalizedWord>((word) => {
        const speaker = hasDiarization
            ? (typeof word.speaker === "number" ? word.speaker : lastSpeaker)
            : null;

        if (speaker !== null) {
            lastSpeaker = speaker;
        }

        return {
            text: word.word,
            punctuatedText: word.punctuated_word ?? word.word,
            startMs: toMs(word.start),
            endMs: toMs(word.end),
            confidence: word.confidence,
            speaker,
            speakerConfidence: word.speaker_confidence ?? null,
            paragraphIndex: null,
            sentenceEnd: false,
        };
    });

    if (!paragraphs || paragraphs.paragraphs.length === 0) {
        return normalized.map((word) => ({
            ...word,
            sentenceEnd: isSentenceBoundary(word.punctuatedText),
        }));
    }

    const paragraphGroups: TimedGroup[] = paragraphs.paragraphs.map((paragraph, index) => ({
        index,
        startMs: toMs(paragraph.start),
        endMs: toMs(paragraph.end),
    }));

    const paragraphIndices = matchTimedGroups(normalized, paragraphGroups);

    const sentenceGroups: TimedGroup[] = paragraphs.paragraphs.flatMap((paragraph, paragraphIndex) =>
        paragraph.sentences.map((sentence, sentenceIndex) => ({
            index: paragraphIndex * 10000 + sentenceIndex,
            startMs: toMs(sentence.start),
            endMs: toMs(sentence.end),
        }))
    );

    const sentenceIndices = matchTimedGroups(normalized, sentenceGroups);

    return normalized.map((word, index) => {
        const sentenceIndex = sentenceIndices[index];
        const nextSentenceIndex = sentenceIndices[index + 1] ?? null;
        const nextWord = normalized[index + 1];
        const metadataSentenceBoundary = (
            sentenceIndex !== null &&
            sentenceIndex !== nextSentenceIndex
        );

        return {
            ...word,
            paragraphIndex: paragraphIndices[index],
            sentenceEnd: inferSentenceEndFromMetadataHint(
                {
                    punctuatedText: word.punctuatedText,
                    endMs: word.endMs,
                    paragraphIndex: paragraphIndices[index],
                },
                nextWord
                    ? {
                        startMs: nextWord.startMs,
                        paragraphIndex: paragraphIndices[index + 1],
                        speaker: nextWord.speaker,
                    }
                    : undefined,
                metadataSentenceBoundary
            ),
        };
    });
}

function finalizeSegment(
    words: NormalizedWord[],
    config: SegmentBuilderConfig
): BuiltSegment {
    const text = normalizeText(words.map((word) => word.punctuatedText));
    const isFillerSegment = (
        getWordCount(text) <= config.minAbsorbWords &&
        isFiller(text, config.fillerPatterns)
    );

    return {
        speakerNum: words[0]?.speaker ?? null,
        startMs: words[0]?.startMs ?? 0,
        endMs: words[words.length - 1]?.endMs ?? 0,
        text,
        words: [...words],
        isFiller: isFillerSegment,
        algoVersion: config.algoVersion,
    };
}

export function buildSegments(
    words: NormalizedWord[],
    config: SegmentBuilderConfig = DEFAULT_SEGMENT_BUILDER_CONFIG
): BuiltSegment[] {
    if (words.length === 0) {
        return [];
    }

    const sortedWords = [...words].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const builtSegments: BuiltSegment[] = [];
    let currentWords: NormalizedWord[] = [sortedWords[0]];

    for (let index = 1; index < sortedWords.length; index++) {
        const currentWord = sortedWords[index];
        const previousWord = sortedWords[index - 1];

        const speakerChanged = currentWord.speaker !== previousWord.speaker;
        const paragraphChanged = (
            currentWord.paragraphIndex !== null &&
            previousWord.paragraphIndex !== null &&
            currentWord.paragraphIndex !== previousWord.paragraphIndex
        );
        const gapExceeded = currentWord.startMs - previousWord.endMs > config.maxGapMs;

        if (speakerChanged || paragraphChanged || gapExceeded) {
            if (currentWords.length > 0) {
                builtSegments.push(finalizeSegment(currentWords, config));
            }
            currentWords = [currentWord];
            continue;
        }

        currentWords.push(currentWord);

        const segmentStartMs = currentWords[0].startMs;
        const currentDurationMs = currentWord.endMs - segmentStartMs;
        const reachedSoftBoundary = (
            currentWords.length >= config.targetWords ||
            currentDurationMs >= config.maxDurationMs
        );
        const exceededHardBoundary = (
            currentWords.length >= config.targetWords + config.maxWordOverrun ||
            currentDurationMs >= config.maxDurationMs + config.maxDurationOverrunMs
        );

        // Prefer sentence-complete segments. Duration and word-count limits now
        // signal "break at the next sentence end" rather than "cut immediately".
        if ((reachedSoftBoundary && currentWord.sentenceEnd) || exceededHardBoundary) {
            builtSegments.push(finalizeSegment(currentWords, config));
            currentWords = [];
        }
    }

    if (currentWords.length > 0) {
        builtSegments.push(finalizeSegment(currentWords, config));
    }
    return builtSegments;
}
