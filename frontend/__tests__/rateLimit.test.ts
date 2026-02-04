/**
 * Tests for Rate Limiting Utility
 */

import { checkRateLimit, RateLimitConfig, RATE_LIMITS } from '../lib/rate-limit';

describe('Rate Limiting', () => {
    const testConfig: RateLimitConfig = {
        maxRequests: 3,
        windowMs: 1000, // 1 second window for fast tests
    };

    describe('checkRateLimit', () => {
        it('should allow requests within the limit', () => {
            const key = `test-user-${Date.now()}-allow`;

            const result1 = checkRateLimit(key, testConfig);
            expect(result1.allowed).toBe(true);
            expect(result1.current).toBe(1);
            expect(result1.limit).toBe(3);

            const result2 = checkRateLimit(key, testConfig);
            expect(result2.allowed).toBe(true);
            expect(result2.current).toBe(2);

            const result3 = checkRateLimit(key, testConfig);
            expect(result3.allowed).toBe(true);
            expect(result3.current).toBe(3);
        });

        it('should block requests exceeding the limit', () => {
            const key = `test-user-${Date.now()}-block`;

            // Use up the limit
            checkRateLimit(key, testConfig);
            checkRateLimit(key, testConfig);
            checkRateLimit(key, testConfig);

            // Fourth request should be blocked
            const result = checkRateLimit(key, testConfig);
            expect(result.allowed).toBe(false);
            expect(result.current).toBe(3); // Still at 3, not incremented
            expect(result.limit).toBe(3);
            expect(result.resetInMs).toBeGreaterThan(0);
            expect(result.resetInMs).toBeLessThanOrEqual(1000);
        });

        it('should use separate buckets for different keys', () => {
            const key1 = `user-1-${Date.now()}`;
            const key2 = `user-2-${Date.now()}`;

            // Exhaust key1's limit
            checkRateLimit(key1, testConfig);
            checkRateLimit(key1, testConfig);
            checkRateLimit(key1, testConfig);
            const key1Result = checkRateLimit(key1, testConfig);
            expect(key1Result.allowed).toBe(false);

            // key2 should still have its full limit
            const key2Result = checkRateLimit(key2, testConfig);
            expect(key2Result.allowed).toBe(true);
            expect(key2Result.current).toBe(1);
        });

        it('should return resetInMs correctly', () => {
            const key = `test-reset-${Date.now()}`;

            const result = checkRateLimit(key, testConfig);
            expect(result.resetInMs).toBe(testConfig.windowMs);
        });
    });

    describe('RATE_LIMITS presets', () => {
        it('should have TRANSCRIPTION_START preset configured', () => {
            expect(RATE_LIMITS.TRANSCRIPTION_START).toBeDefined();
            expect(RATE_LIMITS.TRANSCRIPTION_START.maxRequests).toBe(10);
            expect(RATE_LIMITS.TRANSCRIPTION_START.windowMs).toBe(60 * 60 * 1000); // 1 hour
        });

        it('should have API_GENERAL preset configured', () => {
            expect(RATE_LIMITS.API_GENERAL).toBeDefined();
            expect(RATE_LIMITS.API_GENERAL.maxRequests).toBe(100);
            expect(RATE_LIMITS.API_GENERAL.windowMs).toBe(60 * 1000); // 1 minute
        });
    });
});
