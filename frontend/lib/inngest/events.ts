/**
 * Inngest Event Type Definitions
 *
 * Types are derived from Zod schemas in contracts/events.ts.
 * Used for type-safe event handling in Inngest functions.
 */

import { eventType } from 'inngest'
import type {
    TranscriptionRequestedData,
    MediaPrepareRequestedData,
    TranscriptionWebhookData,
    TranscriptionCompletedData,
    TranscriptionFailedData,
    WaveformRequestedData,
    SonioxCallbackData,
    DeepgramCallbackData,
} from '@/contracts/events'
import {
    TranscriptionRequestedDataSchema,
    MediaPrepareRequestedDataSchema,
    TranscriptionWebhookDataSchema,
    TranscriptionCompletedDataSchema,
    TranscriptionFailedDataSchema,
    WaveformRequestedDataSchema,
    SonioxCallbackDataSchema,
    DeepgramCallbackDataSchema,
} from '@/contracts/events'

export const transcriptionRequestedTrigger = eventType("transcription/requested", {
    schema: TranscriptionRequestedDataSchema,
})

export const mediaPrepareRequestedTrigger = eventType("media/prepare-requested", {
    schema: MediaPrepareRequestedDataSchema,
})

export const transcriptionWebhookTrigger = eventType("transcription/webhook", {
    schema: TranscriptionWebhookDataSchema,
})

export const transcriptionCompletedTrigger = eventType("transcription/completed", {
    schema: TranscriptionCompletedDataSchema,
})

export const transcriptionFailedTrigger = eventType("transcription/failed", {
    schema: TranscriptionFailedDataSchema,
})

export const waveformRequestedTrigger = eventType("waveform/requested", {
    schema: WaveformRequestedDataSchema,
})

export const sonioxCallbackTrigger = eventType("soniox/callback", {
    schema: SonioxCallbackDataSchema,
})

export const deepgramCallbackTrigger = eventType("deepgram/callback", {
    schema: DeepgramCallbackDataSchema,
})

export type TranscriptionEvents = {
    "transcription/requested": {
        data: TranscriptionRequestedData;
    };
    "media/prepare-requested": {
        data: MediaPrepareRequestedData;
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
    "waveform/requested": {
        data: WaveformRequestedData;
    };
    "soniox/callback": {
        data: SonioxCallbackData;
    };
    "deepgram/callback": {
        data: DeepgramCallbackData;
    };
};
