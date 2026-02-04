/**
 * Inngest Client
 * 
 * Central client instance for sending and receiving events.
 * Used by both API routes and background functions.
 */

import { Inngest, EventSchemas } from "inngest";
import type { TranscriptionEvents } from "./events";

export const inngest = new Inngest({
    id: "transcription-app",
    schemas: new EventSchemas().fromRecord<TranscriptionEvents>(),
});
