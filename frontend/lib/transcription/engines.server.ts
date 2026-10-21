/**
 * The transcription engines, by name: the one place that maps an engine to its
 * code. Server-only, since starting a job uses the engine's API key; what an
 * engine can do, for the browser, is in core/transcription/engines/capabilities.ts.
 */

import 'server-only'

import { TranscriptionEngineSchema } from '@/contracts/transcription-options'
import { deepgramResultToWords } from '@/core/transcription/engines/deepgram-words'
import { sonioxResultToWords } from '@/core/transcription/engines/soniox-words'
import type { TranscriptionEngine } from '@/core/transcription/engines/types'
import { getCallbackUrl, startAsyncTranscription } from '@/infra/deepgram'
import { startSonioxTranscription } from '@/infra/soniox'

const deepgram: TranscriptionEngine = {
    id: 'deepgram',
    start: ({ mediaUrl, transcriptId, jobId, userId, keyTerms, options }) =>
        startAsyncTranscription({
            mediaUrl,
            callbackUrl: getCallbackUrl(),
            transcriptId,
            jobId,
            userId,
            keyTerms,
            transcription: options,
        }),
    resultToWords: deepgramResultToWords,
}

const soniox: TranscriptionEngine = {
    id: 'soniox',
    start: startSonioxTranscription,
    resultToWords: sonioxResultToWords,
}

const ENGINES: Record<TranscriptionEngine['id'], TranscriptionEngine> = { deepgram, soniox }

/** The engine of this name; refuses a name that is not one of ours. */
export function getEngine(id: unknown): TranscriptionEngine {
    const parsed = TranscriptionEngineSchema.safeParse(id)
    if (!parsed.success) {
        throw new Error(`Unknown transcription engine: ${String(id)}`)
    }
    return ENGINES[parsed.data]
}
