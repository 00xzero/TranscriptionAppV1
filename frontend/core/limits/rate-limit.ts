/**
 * Rate Limiting Utility
 *
 * Simple in-memory rate limiter with sliding window.
 * For production at scale, consider using Redis or Upstash.
 *
 * This implementation is suitable for single-instance deployments
 * and provides protection against abuse without external dependencies.
 */

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory store - resets on server restart
// For multi-instance deployments, use Redis
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

    lastCleanup = now;
    for (const [key, entry] of rateLimitStore) {
        if (entry.resetAt < now) {
            rateLimitStore.delete(key);
        }
    }
}

export interface RateLimitConfig {
    /** Maximum requests allowed in the window */
    maxRequests: number;
    /** Window size in milliseconds */
    windowMs: number;
}

export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Current request count in this window */
    current: number;
    /** Maximum requests allowed */
    limit: number;
    /** Milliseconds until the window resets */
    resetInMs: number;
}

/**
 * Check rate limit for a given key (e.g., userId, IP address)
 *
 * @param key - Unique identifier for the rate limit bucket
 * @param config - Rate limit configuration
 * @returns Result indicating whether request is allowed
 */
export function checkRateLimit(
    key: string,
    config: RateLimitConfig
): RateLimitResult {
    cleanupExpiredEntries();

    const now = Date.now();
    const entry = rateLimitStore.get(key);

    // No existing entry or expired - create new window
    if (!entry || entry.resetAt < now) {
        rateLimitStore.set(key, {
            count: 1,
            resetAt: now + config.windowMs,
        });
        return {
            allowed: true,
            current: 1,
            limit: config.maxRequests,
            resetInMs: config.windowMs,
        };
    }

    // Within existing window
    const newCount = entry.count + 1;
    const allowed = newCount <= config.maxRequests;

    if (allowed) {
        entry.count = newCount;
    }

    return {
        allowed,
        current: entry.count,
        limit: config.maxRequests,
        resetInMs: entry.resetAt - now,
    };
}

/**
 * Default rate limit configurations for common use cases
 */
export const RATE_LIMITS = {
    /** Transcription start: 10 requests per hour per user */
    TRANSCRIPTION_START: {
        maxRequests: 10,
        windowMs: 60 * 60 * 1000, // 1 hour
    } as RateLimitConfig,

    /** API general: 100 requests per minute per user */
    API_GENERAL: {
        maxRequests: 100,
        windowMs: 60 * 1000, // 1 minute
    } as RateLimitConfig,
} as const;
