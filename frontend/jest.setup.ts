import '@testing-library/jest-dom'

// Polyfill missing DOM APIs in jsdom
if (typeof window !== 'undefined') {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: jest.fn(),
  })
}

// In case any code queries ResizeObserver implicitly
// @ts-ignore
global.ResizeObserver = class {
  observe() { }
  unobserve() { }
  disconnect() { }
}

// Mock Supabase queries for tests
jest.mock('./lib/supabase/queries', () => ({
  fetchTranscriptData: jest.fn().mockResolvedValue({
    items: [
      {
        id: 's1',
        start_ms: 0,
        end_ms: 2000,
        text: 'hello world. Hello again.',
        project_id: 'p1',
        speaker_id: null,
        is_edited: false,
        is_filler: false,
        algo_version: 'test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 's2',
        start_ms: 2000,
        end_ms: 4000,
        text: 'world says hello.',
        project_id: 'p1',
        speaker_id: null,
        is_edited: false,
        is_filler: false,
        algo_version: 'test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ],
  }),
  fetchSpeakers: jest.fn().mockResolvedValue([]),
  fetchProjectById: jest.fn().mockResolvedValue({ id: 'p1', title: 'Test Project', status: 'created' }),
  fetchSegments: jest.fn().mockResolvedValue([]),
  updateSegment: jest.fn().mockResolvedValue({}),
}))
