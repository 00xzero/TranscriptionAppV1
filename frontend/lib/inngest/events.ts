/**
 * Inngest Event Type Definitions
 *
 * Types are derived from Zod schemas in lib/schemas/events.ts.
 * Used for type-safe event handling in Inngest functions.
 */

import type {
    TranscriptionRequestedData,
    TranscriptionWebhookData,
    TranscriptionCompletedData,
    TranscriptionFailedData,
} from '@/lib/schemas/events'

export type TranscriptionEvents = {
    "transcription/requested": {
        data: TranscriptionRequestedData;
    };
    "transcription/webhook": {
        data: TranscriptionWebhookData;
    };
    "transcription/completed": {
        data: TranscriptionCompletedData;
    };
    "transcription/failed": {
        data: TranscriptionFailedData;
    };
};
