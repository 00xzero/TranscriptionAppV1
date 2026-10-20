/**
 * What each transcription engine can do with the options in
 * contracts/transcription-options.ts. Pure data, safe in the browser: the
 * capture dialog reads it as much as the pipeline does.
 */

import {
    TRANSCRIPTION_ENGINE_LABELS,
    TRANSCRIPTION_LANGUAGES,
    type TranscriptionEngine,
    type TranscriptionLanguage,
} from "@/contracts/transcription-options";

export interface EngineCapabilities {
    languages: readonly TranscriptionLanguage[];
    /** Languages in which the engine can keep "um" and "uh". */
    fillerWordLanguages: readonly TranscriptionLanguage[];
    maskProfanity: boolean;
    /** The longest audio the engine accepts, or null for no limit of its own. */
    maxDurationSeconds: number | null;
}

export const ENGINE_CAPABILITIES: Record<TranscriptionEngine, EngineCapabilities> = {
    deepgram: {
        languages: TRANSCRIPTION_LANGUAGES,
        // Nova-3 keeps filler words only in English.
        fillerWordLanguages: ["en"],
        maskProfanity: true,
        maxDurationSeconds: null,
    },
    soniox: {
        languages: TRANSCRIPTION_LANGUAGES,
        // stt-async-v5 writes clean verbatim: no "um" or "uh", whatever it is asked.
        fillerWordLanguages: [],
        maskProfanity: false,
        // Five hours per file, a limit Soniox does not raise.
        maxDurationSeconds: 300 * 60,
    },
};

/** Whether the engine can mask swear words. */
export function profanityMaskingApplies(engine: TranscriptionEngine): boolean {
    return ENGINE_CAPABILITIES[engine].maskProfanity;
}

/** Whether the engine can keep "um" and "uh" in this language. */
export function fillerWordsApply(engine: TranscriptionEngine, language: TranscriptionLanguage): boolean {
    return ENGINE_CAPABILITIES[engine].fillerWordLanguages.includes(language);
}

function formatLength(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes} min`;
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * Why this engine can't take audio this long, for the person who chose it; null
 * when it can (or the engine sets no limit).
 */
export function engineLengthRefusal(engine: TranscriptionEngine, durationSeconds: number): string | null {
    const limit = ENGINE_CAPABILITIES[engine].maxDurationSeconds;
    if (limit === null || durationSeconds <= limit) return null;
    // The file's length rounds up, so it never reads as no longer than the limit.
    return `${TRANSCRIPTION_ENGINE_LABELS[engine]} accepts audio up to ${formatLength(limit / 60)}; this file is ${formatLength(Math.ceil(durationSeconds / 60))}. Choose Deepgram Nova-3 for longer files.`;
}
