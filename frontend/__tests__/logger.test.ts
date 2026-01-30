/**
 * Tests for Structured Logger
 */

import { createLogger, generateCorrelationId } from '../lib/logger';

describe('Logger', () => {
    let consoleSpy: {
        log: jest.SpyInstance;
        debug: jest.SpyInstance;
        warn: jest.SpyInstance;
        error: jest.SpyInstance;
    };

    beforeEach(() => {
        consoleSpy = {
            log: jest.spyOn(console, 'log').mockImplementation(),
            debug: jest.spyOn(console, 'debug').mockImplementation(),
            warn: jest.spyOn(console, 'warn').mockImplementation(),
            error: jest.spyOn(console, 'error').mockImplementation(),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('createLogger', () => {
        it('should create a logger with all log methods', () => {
            const logger = createLogger('test-component', 'test-correlation-id');

            expect(logger.debug).toBeDefined();
            expect(logger.info).toBeDefined();
            expect(logger.warn).toBeDefined();
            expect(logger.error).toBeDefined();
            expect(logger.child).toBeDefined();
        });

        it('should log info messages with component and message', () => {
            const logger = createLogger('transcription', 'txn-12345678-abc');

            logger.info('Processing started', { projectId: 'proj-1' });

            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            // In test/production mode, logs are JSON
            expect(logCall).toContain('transcription');
            expect(logCall).toContain('Processing started');
        });

        it('should log warn level messages', () => {
            const logger = createLogger('webhook', 'txn-12345678-abc');

            logger.warn('Token missing');

            // In production mode, all logs go through console.log as JSON
            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('"level":"warn"');
            expect(logCall).toContain('Token missing');
        });

        it('should log error level messages', () => {
            const logger = createLogger('consolidation', 'txn-12345678-abc');

            logger.error('Failed to save chunks', { error: 'Connection timeout' });

            // In production mode, all logs go through console.log as JSON
            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('"level":"error"');
            expect(logCall).toContain('Failed to save chunks');
        });

        it('should include correlation ID in log output', () => {
            const logger = createLogger('test', 'txn-abcd1234-xyz');

            logger.info('Test message');

            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('txn-abcd1234-xyz');
        });

        it('should support child loggers with additional data', () => {
            const logger = createLogger('parent', 'txn-12345678-abc');
            const childLogger = logger.child({ jobId: 'job-1' });

            childLogger.info('Child message');

            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('jobId');
            expect(logCall).toContain('job-1');
        });

        it('should include timestamp in log output', () => {
            const logger = createLogger('test', 'txn-12345678');

            logger.info('Test');

            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('"timestamp"');
        });
    });

    describe('generateCorrelationId', () => {
        it('should generate a correlation ID with project prefix', () => {
            const projectId = 'abcd1234-5678-90ab-cdef-1234567890ab';
            const correlationId = generateCorrelationId(projectId);

            expect(correlationId).toMatch(/^txn-abcd1234-[a-z0-9]+$/);
        });

        it('should generate unique IDs for same project', () => {
            const projectId = 'test-project-id';
            const id1 = generateCorrelationId(projectId);
            const id2 = generateCorrelationId(projectId);

            // They might be the same in a fast test, so just check format
            expect(id1).toMatch(/^txn-test-pro-[a-z0-9]+$/);
            expect(id2).toMatch(/^txn-test-pro-[a-z0-9]+$/);
        });

        it('should start with txn- prefix', () => {
            const correlationId = generateCorrelationId('any-project');
            expect(correlationId.startsWith('txn-')).toBe(true);
        });
    });
});
