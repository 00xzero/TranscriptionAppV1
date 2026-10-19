/**
 * What each transcription engine can do with the options in
 * contracts/transcription-options.ts. Pure data, safe in the browser: the
 * capture dialog reads it as much as the pipeline does.
 */

import {
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
};

/** Whether the engine can keep "um" and "uh" in this language. */
export function fillerWordsApply(engine: TranscriptionEngine, language: TranscriptionLanguage): boolean {
    return ENGINE_CAPABILITIES[engine].fillerWordLanguages.includes(language);
}
