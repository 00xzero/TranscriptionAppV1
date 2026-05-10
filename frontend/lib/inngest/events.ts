/**
 * Inngest Event Type Definitions
 *
 * Types are derived from Zod schemas in contracts/events.ts.
 * Used for type-safe event handling in Inngest functions.
 */

import { eventType } from 'inngest'
import type {
    TranscriptionRequestedData,
    TranscriptionWebhookData,
    TranscriptionCompletedData,
    TranscriptionFailedData,
    WaveformRequestedData,
} from '@/contracts/events'
import {
    TranscriptionRequestedDataSchema,
    TranscriptionWebhookDataSchema,
    TranscriptionCompletedDataSchema,
    TranscriptionFailedDataSchema,
    WaveformRequestedDataSchema,
} from '@/contracts/events'

export const transcriptionRequestedTrigger = eventType("transcription/requested", {
    schema: TranscriptionRequestedDataSchema,
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
    "waveform/requested": {
        data: WaveformRequestedData;
    };
};
