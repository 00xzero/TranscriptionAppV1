/**
 * Inngest Event Type Definitions
 * 
 * Defines the event schema for the transcription lifecycle.
 * Used for type-safe event handling in Inngest functions.
 */

export type TranscriptionEvents = {
    "transcription/requested": {
        data: {
            projectId: string;
            userId: string;
            mediaUrl: string;
            keyTerms?: string[];
        };
    };
    "transcription/webhook": {
        data: {
            requestId: string;
            projectId: string;
            result: unknown;
        };
    };
    "transcription/completed": {
        data: {
            projectId: string;
            jobId: string;
            duration: number;
        };
    };
    "transcription/failed": {
        data: {
            projectId: string;
            jobId: string;
            error: string;
            errorType: "keyterm" | "general";
        };
    };
};
