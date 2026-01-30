/**
 * Structured Logger
 * 
 * Provides structured JSON logging with correlation IDs for request tracing.
 * All log entries include timestamp, correlation ID, and structured metadata.
 * 
 * Usage:
 *   const log = createLogger('transcription', projectId);
 *   log.info('Processing started', { jobId });
 *   log.error('Failed to process', { error: err.message });
 */

export interface LogEntry {
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    correlationId: string;
    component: string;
    message: string;
    data?: Record<string, unknown>;
}

export interface Logger {
    debug: (message: string, data?: Record<string, unknown>) => void;
    info: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
    child: (additionalData: Record<string, unknown>) => Logger;
}

/**
 * Create a logger instance with a correlation ID
 * 
 * @param component - Component name (e.g., 'transcription', 'webhook', 'consolidation')
 * @param correlationId - Unique ID to trace requests through the pipeline
 * @param baseData - Optional data to include in all log entries
 */
export function createLogger(
    component: string,
    correlationId: string,
    baseData?: Record<string, unknown>
): Logger {
    const log = (
        level: LogEntry["level"],
        message: string,
        data?: Record<string, unknown>
    ) => {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            correlationId,
            component,
            message,
            ...(baseData || data ? { data: { ...baseData, ...data } } : {}),
        };

        // In development, use pretty printing; in production, use JSON
        if (process.env.NODE_ENV === "development") {
            const prefix = `[${entry.component}] [${entry.correlationId.slice(0, 8)}]`;
            const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
            switch (level) {
                case "debug":
                    console.debug(`${prefix} ${message}${dataStr}`);
                    break;
                case "info":
                    console.log(`${prefix} ${message}${dataStr}`);
                    break;
                case "warn":
                    console.warn(`${prefix} ${message}${dataStr}`);
                    break;
                case "error":
                    console.error(`${prefix} ${message}${dataStr}`);
                    break;
            }
        } else {
            // Production: JSON for log aggregation tools
            console.log(JSON.stringify(entry));
        }
    };

    return {
        debug: (message, data) => log("debug", message, data),
        info: (message, data) => log("info", message, data),
        warn: (message, data) => log("warn", message, data),
        error: (message, data) => log("error", message, data),
        child: (additionalData) =>
            createLogger(component, correlationId, { ...baseData, ...additionalData }),
    };
}

/**
 * Generate a correlation ID for a transcription request
 * Format: txn-{projectId-prefix}-{timestamp}
 */
export function generateCorrelationId(projectId: string): string {
    const prefix = projectId.slice(0, 8);
    const timestamp = Date.now().toString(36);
    return `txn-${prefix}-${timestamp}`;
}
