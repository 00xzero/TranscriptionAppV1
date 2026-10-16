/**
 * Inngest Client
 *
 * Central client instance for sending and receiving events.
 * Used by both API routes and background functions.
 */

import { Inngest } from "inngest";
import type { SendEventPayload, SendEventBaseOutput } from "inngest";
import type { TranscriptionEvents } from "@/lib/inngest/events";

type TranscriptionEventPayload = {
    [Name in keyof TranscriptionEvents]: {
        name: Name;
        data: TranscriptionEvents[Name]["data"];
    };
}[keyof TranscriptionEvents];

export const inngest = new Inngest({
    id: "transcription-app",
    isDev: process.env.INNGEST_DEV === "1" || process.env.NODE_ENV === "development",
});

export function sendInngestEvent(
    payload: TranscriptionEventPayload | TranscriptionEventPayload[]
): Promise<SendEventBaseOutput> {
    return inngest.send(payload as SendEventPayload);
}
