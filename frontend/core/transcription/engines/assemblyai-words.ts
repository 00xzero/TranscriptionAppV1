/**
 * A stored AssemblyAI result → our words. AssemblyAI returns whole words with
 * their times; Japanese comes as pieces (こ / ん / にちは。). Where a word sits
 * against the one before is read from AssemblyAI's own text, so pieces it wrote
 * together rejoin and the spaces it wrote around them stay. Pure: the stored
 * result comes in as text.
 */

import { AssemblyAITranscriptSchema, type AssemblyAIWord } from "@/contracts/assemblyai";
import type { NormalizedWord } from "@/core/transcript/segment-builder";
import { ENDS_NO_SPACE, isSentenceBoundary, STARTS_NO_SPACE } from "@/core/transcript/text-utils";
import type { EngineWords } from "./types";
import { plainWordText, speakerNumberer } from "./word-text";

// How far past the last word the next one is looked for in the text: further
// would risk matching a later copy of the same word.
const SEARCH_WINDOW = 32;

/**
 * Whether each word is written straight after the one before, read from the
 * text AssemblyAI wrote. A word not found near where the last one ended falls
 * back to a space, unless both sides are a script written without spaces.
 */
function joinsFromText(words: AssemblyAIWord[], text: string): boolean[] {
    const joins: boolean[] = [];
    let position = 0;
    words.forEach((word, index) => {
        const found = text.indexOf(word.text, position);
        if (found !== -1 && found - position <= SEARCH_WINDOW) {
            joins.push(index > 0 && !/\s/.test(text.slice(position, found)));
            position = found + word.text.length;
            return;
        }
        const previous = words[index - 1];
        joins.push(!!previous && STARTS_NO_SPACE.test(word.text) && ENDS_NO_SPACE.test(previous.text));
    });
    return joins;
}

/**
 * Parse a stored AssemblyAI result and return its words. Speaker labels ("A",
 * "B"…) become 0, 1… in the order they first speak; without speakers asked
 * for, words have none. Refuses a result that is not AssemblyAI's shape.
 */
export function assemblyaiResultToWords(rawJson: string): EngineWords {
    const parsed = AssemblyAITranscriptSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) {
        throw new Error(`Invalid AssemblyAI result structure: ${parsed.error.issues[0]?.message ?? "Invalid input"}`);
    }
    const result = parsed.data;
    const text = result.text ?? "";
    const sourceWords = result.words ?? [];
    const joins = joinsFromText(sourceWords, text);
    const speakerNumber = speakerNumberer();

    const words = sourceWords.map<NormalizedWord>((word, index) => {
        const punctuatedText = word.text.trim();
        return {
            ...(joins[index] ? { joinsPrevious: true } : {}),
            text: plainWordText(punctuatedText),
            punctuatedText,
            startMs: word.start,
            endMs: word.end,
            confidence: word.confidence,
            speaker: speakerNumber(word.speaker),
            speakerConfidence: null,
            paragraphIndex: null,
            sentenceEnd: isSentenceBoundary(punctuatedText),
        };
    });

    return { words, fallbackText: text, model: result.speech_model_used ?? null };
}
