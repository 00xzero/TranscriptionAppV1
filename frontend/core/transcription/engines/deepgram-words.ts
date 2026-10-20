/**
 * A stored Deepgram response → our words. Deepgram's own word list carries the
 * timing, speaker and punctuation; its paragraphs and sentences are used as
 * hints for where sentences end. Pure: the stored response comes in as text.
 */

import {
    DeepgramWebhookPayloadSchema,
    type DeepgramParagraph,
    type DeepgramWord,
} from "@/contracts/webhook";
import type { NormalizedWord } from "@/core/transcript/segment-builder";
import { isSentenceBoundary, NO_SPACE_CHAR } from "@/core/transcript/text-utils";
import type { EngineWords } from "./types";

const TIMESTAMP_TOLERANCE_MS = 50;
const METADATA_SENTENCE_GAP_MS = 800;

/** Deepgram's paragraphs, used as hints for paragraph and sentence ends. */
export interface ParagraphMetadata {
    paragraphs: Array<Pick<DeepgramParagraph, "speaker" | "start" | "end" | "sentences">>;
}

interface TimedGroup {
    index: number;
    startMs: number;
    endMs: number;
}

function inferSentenceEndFromMetadataHint(
    word: Pick<NormalizedWord, "punctuatedText" | "endMs" | "paragraphIndex">,
    nextWord: Pick<NormalizedWord, "startMs" | "paragraphIndex" | "speaker"> | undefined,
    metadataSentenceBoundary: boolean
): boolean {
    if (isSentenceBoundary(word.punctuatedText)) {
        return true;
    }

    // Explicit non-terminal punctuation (comma, semicolon, colon, dash) is strong
    // counter-evidence to any metadata-based sentence boundary signal, Japanese
    // 、，；： included. Deepgram occasionally splits paragraphs mid-clause at a
    // comma; trust the punctuation.
    if (/[,;:\-、，；：]$/.test(word.punctuatedText.trimEnd())) {
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

/**
 * Parse a stored Deepgram response and return its words. The first channel's
 * first alternative is the transcript; with no words, its text is kept so the
 * transcript is not left blank. Refuses a response that is not Deepgram's shape.
 */
export function deepgramResultToWords(rawJson: string): EngineWords {
    const parsed = DeepgramWebhookPayloadSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) {
        throw new Error(`Invalid Deepgram payload structure: ${parsed.error.issues[0]?.message ?? 'Invalid input'}`);
    }
    const alt = parsed.data.results?.channels?.[0]?.alternatives?.[0];
    const rawWords = alt?.words ?? [];
    return {
        words: rawWords.length > 0 ? markWrittenJoins(normalizeWords(rawWords, alt?.paragraphs ?? null), alt?.transcript) : [],
        fallbackText: alt?.transcript ?? "",
    };
}

/**
 * Deepgram's words carry no spacing, but its transcript does: Japanese is
 * written with no space between words. Each word is found in the transcript in
 * order, and one written straight after the word before is marked as joining
 * it. A word that can't be found where expected keeps its space (the default),
 * and the search steps past it only when it turns up a little further on.
 * Only words next to a script written without spaces are ever joined, so a
 * search that picks up inside a longer word can't glue two English words
 * together.
 */
function markWrittenJoins(words: NormalizedWord[], transcript: string | undefined): NormalizedWord[] {
    if (!transcript) return words;
    let cursor = 0;
    return words.map((word, index) => {
        const leading = /^\s*/.exec(transcript.slice(cursor))?.[0].length ?? 0;
        const at = cursor + leading;
        if (transcript.startsWith(word.punctuatedText, at)) {
            cursor = at + word.punctuatedText.length;
            const joins = index > 0 && leading === 0 &&
                (NO_SPACE_CHAR.test(word.punctuatedText) || NO_SPACE_CHAR.test(words[index - 1].punctuatedText));
            return joins ? { ...word, joinsPrevious: true } : word;
        }
        // Look only a little ahead: far enough to step over a word Deepgram
        // wrote differently in its transcript, never so far that a common
        // one-character word is found again in a later sentence, which would
        // leave every word after it unjoined. Not found nearby, the cursor stays.
        const later = transcript.indexOf(word.punctuatedText, cursor);
        if (later >= 0 && later - cursor <= Math.max(4, 2 * word.punctuatedText.length)) {
            cursor = later + word.punctuatedText.length;
        }
        return word;
    });
}
