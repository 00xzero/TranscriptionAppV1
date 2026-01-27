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
            jobId: string;
            userId: string;
            mediaUrl: string;
            keyTerms?: string[];
        };
    };
    "transcription/webhook": {
        data: {
            requestId: string;
            projectId: string;
        };
    };
    "transcription/completed": {
        data: {
            projectId: string;
            jobId: string;
            duration: number;
            chunkCount?: number;
            chunkWordCount?: number;
            algoVersion?: string;
        };
    };
    "transcription/failed": {
        data: {
            projectId: string;
            jobId: string;
            error: string;
            errorType: "keyterm_error" | "transcription_error";
        };
    };
};
