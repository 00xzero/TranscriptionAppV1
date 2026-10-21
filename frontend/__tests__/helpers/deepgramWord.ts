import type { DeepgramWord } from "@/contracts/webhook";

/** A Deepgram word, with times in milliseconds for readability. */
export function createRawWord({
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
