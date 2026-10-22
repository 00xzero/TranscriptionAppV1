/**
 * What each transcription engine can do with the options in
 * contracts/transcription-options.ts. Pure data, safe in the browser: the
 * capture dialog reads it as much as the pipeline does.
 */

import {
    TRANSCRIPTION_ENGINES,
    TRANSCRIPTION_ENGINE_LABELS,
    TRANSCRIPTION_LANGUAGES,
    type TranscriptionEngine,
    type TranscriptionLanguage,
    type TranscriptionOptions,
} from "@/contracts/transcription-options";

export interface EngineCapabilities {
    languages: readonly TranscriptionLanguage[];
    /** Languages in which keeping "um" and "uh" is the person's choice. */
    fillerWordLanguages: readonly TranscriptionLanguage[];
    /** Languages in which the engine keeps "um" and "uh" whatever it is asked. */
    fillerWordsAlwaysKeptLanguages: readonly TranscriptionLanguage[];
    /** Languages in which the engine can mask swear words. */
    profanityLanguages: readonly TranscriptionLanguage[];
    /** The longest audio the engine accepts, or null for no limit of its own. */
    maxDurationSeconds: number | null;
}

export const ENGINE_CAPABILITIES: Record<TranscriptionEngine, EngineCapabilities> = {
    deepgram: {
        languages: TRANSCRIPTION_LANGUAGES,
        // Nova-3 keeps filler words only in English.
        fillerWordLanguages: ["en"],
        fillerWordsAlwaysKeptLanguages: [],
        profanityLanguages: TRANSCRIPTION_LANGUAGES,
        maxDurationSeconds: null,
    },
    soniox: {
        languages: TRANSCRIPTION_LANGUAGES,
        // stt-async-v5 writes clean verbatim: no "um" or "uh", whatever it is asked.
        fillerWordLanguages: [],
        fillerWordsAlwaysKeptLanguages: [],
        profanityLanguages: [],
        // Five hours per file, a limit Soniox does not raise.
        maxDurationSeconds: 300 * 60,
    },
    assemblyai: {
        languages: TRANSCRIPTION_LANGUAGES,
        fillerWordLanguages: [],
        // Universal-3.5 Pro keeps "um" and "uh" whatever it is asked, and
        // Universal-2 (Russian) is asked to keep them too.
        fillerWordsAlwaysKeptLanguages: TRANSCRIPTION_LANGUAGES,
        // AssemblyAI refuses profanity masking for Russian.
        profanityLanguages: TRANSCRIPTION_LANGUAGES.filter((language) => language !== "ru"),
        // Ten hours per file.
        maxDurationSeconds: 10 * 3600,
    },
};

/** Whether the engine can mask swear words in this language. */
export function profanityMaskingApplies(engine: TranscriptionEngine, language: TranscriptionLanguage): boolean {
    return ENGINE_CAPABILITIES[engine].profanityLanguages.includes(language);
}

/** Whether keeping "um" and "uh" is the person's choice with this engine and language. */
export function fillerWordsApply(engine: TranscriptionEngine, language: TranscriptionLanguage): boolean {
    return ENGINE_CAPABILITIES[engine].fillerWordLanguages.includes(language);
}

/** Whether the engine keeps "um" and "uh" in this language whatever it is asked. */
export function fillerWordsAlwaysKept(engine: TranscriptionEngine, language: TranscriptionLanguage): boolean {
    return ENGINE_CAPABILITIES[engine].fillerWordsAlwaysKeptLanguages.includes(language);
}

/**
 * Whether the transcript is recorded as keeping "um" and "uh": what the engine
 * will really do, whatever the switch was left at.
 */
export function storedFillerWords(options: TranscriptionOptions): boolean {
    if (fillerWordsAlwaysKept(options.engine, options.language)) return true;
    return options.keep_filler_words && fillerWordsApply(options.engine, options.language);
}

/** Whether the transcript is recorded as masking swear words: only where the engine can. */
export function storedProfanityMasking(options: TranscriptionOptions): boolean {
    return options.mask_profanity && profanityMaskingApplies(options.engine, options.language);
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
    // A transcript's engine is fixed, so another one means uploading again.
    const others = TRANSCRIPTION_ENGINES.filter((other) => {
        const otherLimit = ENGINE_CAPABILITIES[other].maxDurationSeconds;
        return otherLimit === null || durationSeconds <= otherLimit;
    }).map((other) => TRANSCRIPTION_ENGINE_LABELS[other]);
    const advice = others.length > 0 ? ` Upload it again and choose ${others.join(" or ")}.` : "";
    // The file's length rounds up, so it never reads as no longer than the limit.
    return `${TRANSCRIPTION_ENGINE_LABELS[engine]} accepts audio up to ${formatLength(limit / 60)}; this file is ${formatLength(Math.ceil(durationSeconds / 60))}.${advice}`;
}
