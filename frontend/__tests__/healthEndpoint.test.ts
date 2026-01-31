/**
 * Tests for Rate Limiting Utility in Start Route context
 * (Health endpoint tests moved to integration tests as they require Next.js runtime)
 */

import { checkRateLimit, RATE_LIMITS, RateLimitConfig } from '../lib/rate-limit';

describe('Rate Limiting in Start Route', () => {
    const transcriptionConfig = RATE_LIMITS.TRANSCRIPTION_START;

    it('should allow first transcription request', () => {
        const userId = `user-${Date.now()}-first`;
        const key = `transcription:${userId}`;

        const result = checkRateLimit(key, transcriptionConfig);

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(10);
    });

    it('should track requests across multiple calls', () => {
        const userId = `user-${Date.now()}-track`;
        const key = `transcription:${userId}`;

        for (let i = 0; i < 5; i++) {
            checkRateLimit(key, transcriptionConfig);
        }

        const result = checkRateLimit(key, transcriptionConfig);
        expect(result.current).toBe(6);
        expect(result.allowed).toBe(true);
    });

    it('should block after exceeding 10 requests', () => {
        const userId = `user-${Date.now()}-block`;
        const key = `transcription:${userId}`;

        // Use up all 10 requests
        for (let i = 0; i < 10; i++) {
            const r = checkRateLimit(key, transcriptionConfig);
            expect(r.allowed).toBe(true);
        }

        // 11th should be blocked
        const blocked = checkRateLimit(key, transcriptionConfig);
        expect(blocked.allowed).toBe(false);
        expect(blocked.current).toBe(10);
    });

    it('should provide retry information when blocked', () => {
        const userId = `user-${Date.now()}-retry`;
        const key = `transcription:${userId}`;
        const shortConfig: RateLimitConfig = { maxRequests: 1, windowMs: 5000 };

        checkRateLimit(key, shortConfig); // Use up the limit
        const blocked = checkRateLimit(key, shortConfig);

        expect(blocked.allowed).toBe(false);
        expect(blocked.resetInMs).toBeGreaterThan(0);
        expect(blocked.resetInMs).toBeLessThanOrEqual(5000);
    });

    it('should isolate rate limits per user', () => {
        const user1 = `user-${Date.now()}-a`;
        const user2 = `user-${Date.now()}-b`;
        const config: RateLimitConfig = { maxRequests: 2, windowMs: 10000 };

        // Exhaust user1's limit
        checkRateLimit(`transcription:${user1}`, config);
        checkRateLimit(`transcription:${user1}`, config);
        const user1Result = checkRateLimit(`transcription:${user1}`, config);
        expect(user1Result.allowed).toBe(false);

        // user2 should still have full limit
        const user2Result = checkRateLimit(`transcription:${user2}`, config);
        expect(user2Result.allowed).toBe(true);
        expect(user2Result.current).toBe(1);
    });
});
