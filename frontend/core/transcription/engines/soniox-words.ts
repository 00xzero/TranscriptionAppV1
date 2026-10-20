/**
 * A stored Soniox result → our words. Soniox returns pieces of words, so they
 * are joined back into words here; timings are kept exactly as Soniox gave
 * them. Pure: the stored result comes in as text.
 */

import { SonioxStoredResultSchema, type SonioxToken } from "@/contracts/soniox";
import type { NormalizedWord } from "@/core/transcript/segment-builder";
import { isSentenceBoundary } from "@/core/transcript/text-utils";
import type { EngineWords } from "./types";

// Scripts written without spaces between words: each piece is a word of its own.
const NO_SPACE_SCRIPT = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// What makes a word a word rather than stray punctuation (marks keep Devanagari's
// vowel signs).
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
const OUTER_PUNCTUATION = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;

interface WordInProgress {
    raw: string;
    startMs: number;
    endMs: number;
    confidence: number;
    speakerLabel: string | null;
}

/** Pieces that are spoken words of the transcript, with timing. */
function spokenPieces(tokens: SonioxToken[]): Array<SonioxToken & { start_ms: number; end_ms: number }> {
    return tokens.filter(
        (token): token is SonioxToken & { start_ms: number; end_ms: number } =>
            token.translation_status !== "translation" &&
            token.is_audio_event !== true &&
            typeof token.start_ms === "number" &&
            typeof token.end_ms === "number"
    );
}

function startsWord(token: SonioxToken, speakerLabel: string | null, current: WordInProgress | null): boolean {
    if (!current) return true;
    if (speakerLabel !== current.speakerLabel) return true;
    if (/^\s/.test(token.text)) return true;
    return NO_SPACE_SCRIPT.test(token.text);
}

/** Join pieces into words. */
function joinPieces(tokens: SonioxToken[]): WordInProgress[] {
    const words: WordInProgress[] = [];
    let current: WordInProgress | null = null;
    // A piece without a label speaks for the last one labelled, decided before
    // word boundaries, so a missing label never splits a word.
    let lastLabel: string | null = null;

    for (const token of spokenPieces(tokens)) {
        const speakerLabel: string | null = token.speaker ?? lastLabel;
        lastLabel = speakerLabel;
        if (startsWord(token, speakerLabel, current)) {
            current = {
                raw: token.text,
                startMs: token.start_ms,
                endMs: token.end_ms,
                confidence: token.confidence,
                speakerLabel,
            };
            words.push(current);
        } else if (current) {
            current.raw += token.text;
            current.endMs = token.end_ms;
            current.confidence = Math.min(current.confidence, token.confidence);
        }
    }

    // Punctuation on its own closes the word before it, whoever Soniox gave it
    // to; with no word before it, there is nothing to attach it to.
    const merged: WordInProgress[] = [];
    for (const word of words) {
        if (WORD_CHARACTER.test(word.raw)) {
            merged.push(word);
            continue;
        }
        const previous = merged[merged.length - 1];
        if (previous) {
            previous.raw += word.raw.trim();
            previous.endMs = Math.max(previous.endMs, word.endMs);
            previous.confidence = Math.min(previous.confidence, word.confidence);
        }
    }
    return merged;
}

/**
 * Parse a stored Soniox result and return its words. Speaker labels become
 * 0, 1, 2… in the order they first speak; a piece without one takes the last.
 * Refuses a result that is not Soniox's shape.
 */
export function sonioxResultToWords(rawJson: string): EngineWords {
    const parsed = SonioxStoredResultSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) {
        throw new Error(`Invalid Soniox result structure: ${parsed.error.issues[0]?.message ?? "Invalid input"}`);
    }
    const { transcript } = parsed.data;
    const joined = joinPieces(transcript.tokens);

    // Labels were carried forward while joining; only words before the first
    // label have none.
    const speakerNumbers = new Map<string, number>();

    const words = joined.map<NormalizedWord>((word) => {
        let speaker: number | null = null;
        if (word.speakerLabel !== null) {
            if (!speakerNumbers.has(word.speakerLabel)) {
                speakerNumbers.set(word.speakerLabel, speakerNumbers.size);
            }
            speaker = speakerNumbers.get(word.speakerLabel) ?? null;
        }

        const punctuatedText = word.raw.trim();
        return {
            text: punctuatedText.replace(OUTER_PUNCTUATION, "").toLowerCase(),
            punctuatedText,
            startMs: word.startMs,
            endMs: word.endMs,
            confidence: word.confidence,
            speaker,
            speakerConfidence: null,
            paragraphIndex: null,
            sentenceEnd: isSentenceBoundary(punctuatedText),
        };
    });

    return { words, fallbackText: transcript.text };
}
