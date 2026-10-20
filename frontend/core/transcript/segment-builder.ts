import {
    DEFAULT_FILLER_PATTERNS,
    getWordCount,
    isFiller,
    normalizeText,
} from "@/core/transcript/text-utils";

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
    /**
     * Written straight after the word before, with no space between them
     * (scripts such as Japanese). Only some engines say so; unset means a space.
     */
    joinsPrevious?: boolean;
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

/**
 * The words as they were written: a word that joins the one before it is glued
 * to it, so normalizeText puts spaces only where the engine had them.
 */
function joinWords(words: NormalizedWord[]): string[] {
    const texts: string[] = [];
    for (const [index, word] of words.entries()) {
        if (index > 0 && word.joinsPrevious) {
            texts[texts.length - 1] += word.punctuatedText.trim();
        } else {
            texts.push(word.punctuatedText);
        }
    }
    return texts;
}

function finalizeSegment(
    words: NormalizedWord[],
    config: SegmentBuilderConfig
): BuiltSegment {
    const text = normalizeText(joinWords(words));
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
