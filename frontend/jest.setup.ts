import '@testing-library/jest-dom'

process.env.NEXT_PUBLIC_RECORDING_DEV_CONTROLS = 'true'

// Polyfill missing DOM APIs in jsdom
if (typeof window !== 'undefined') {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: jest.fn(),
  })
  // jsdom implements no scrolling, so the carousel's paging calls would throw.
  Object.defineProperty(window.HTMLElement.prototype, 'scrollBy', {
    writable: true,
    value: jest.fn(),
  })
  // Radix menus/dropdowns driven by userEvent call the Pointer Capture APIs,
  // which jsdom does not implement. Stub them so components can open in tests.
  for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    Object.defineProperty(window.HTMLElement.prototype, method, {
      writable: true,
      value: jest.fn(),
    })
  }
}

beforeEach(() => {
  const { __resetForTesting: __resetRecordingSession } =
    require('@/lib/recording/session') as typeof import('@/lib/recording/session')
  __resetRecordingSession()
})

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
        transcript_id: 'p1',
        speaker_id: null,
        is_edited: false,
        is_filler: false,
        algo_version: 'test',
        revision: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 's2',
        start_ms: 2000,
        end_ms: 4000,
        text: 'world says hello.',
        transcript_id: 'p1',
        speaker_id: null,
        is_edited: false,
        is_filler: false,
        algo_version: 'test',
        revision: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ],
  }),
  // No stored words by default: cards fall back to spreading words evenly.
  fetchSegmentWordSets: jest.fn().mockResolvedValue([]),
  fetchSegmentsWithWords: jest.fn().mockResolvedValue([]),
  fetchSpeakers: jest.fn().mockResolvedValue([]),
  fetchTranscriptById: jest.fn().mockResolvedValue({ id: 'p1', title: 'Test Transcript', status: 'created' }),
  fetchSegments: jest.fn().mockResolvedValue([]),
  fetchSegmentSpeakerAssignments: jest.fn().mockResolvedValue([]),
  updateTranscript: jest.fn().mockResolvedValue({}),
  // The editor's guarded writes answer with what they wrote.
  updateTranscriptTitleGuarded: jest.fn(async (id: string, _expected: string | null, title: string | null) => ({ id, title })),
  setSegmentTexts: jest.fn(async (edits: { segment_id: string; text: string; expected_revision: number }[]) =>
    edits.map((edit) => ({ id: edit.segment_id, text: edit.text, revision: edit.expected_revision }))),
  reassignSegments: jest.fn().mockResolvedValue([]),
  setSpeakerCustomLabel: jest.fn(),
  fetchEditorPeopleContext: jest.fn().mockResolvedValue({ people: [] }),
  createLocalSpeaker: jest.fn(),
  renamePerson: jest.fn(),
  correctSegmentsToPerson: jest.fn(),
  undoCreatedPerson: jest.fn(),
  restoreCreatedPerson: jest.fn(),
  fetchPeopleDirectory: jest.fn().mockResolvedValue({ people: [], organisations: [] }),
  fetchPersonAppearances: jest.fn().mockResolvedValue([]),
  fetchMergePreview: jest.fn(),
  createPerson: jest.fn(),
  setPersonOrganisation: jest.fn(),
  setPersonColor: jest.fn(),
  setPersonHidden: jest.fn(),
  deletePerson: jest.fn(),
  removePersonFromTranscript: jest.fn(),
  mergePeople: jest.fn(),
  renameOrganisation: jest.fn(),
  deleteOrganisation: jest.fn(),
  // Any surface rendering a project card or header reaches for this. Defaulting
  // it to an empty map keeps those tests from hitting an undefined export and
  // silently exercising the hook's error path.
  fetchProjectSpeakerSummaries: jest.fn().mockResolvedValue(new Map()),
  fetchProjectPeople: jest.fn().mockResolvedValue({ people: [], voices: [] }),
  // Tags: none by default, and every write succeeds.
  fetchTags: jest.fn().mockResolvedValue([]),
  fetchTranscriptTags: jest.fn().mockResolvedValue([]),
  addTranscriptTag: jest.fn().mockResolvedValue(undefined),
  removeTranscriptTag: jest.fn().mockResolvedValue(undefined),
  createTranscriptTag: jest.fn(async (_transcriptId: string, id: string, name: string, color: string) => ({
    tag: { id, user_id: 'u1', name, color, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
    outcome: 'created',
  })),
  undoCreatedTag: jest.fn().mockResolvedValue('deleted'),
  renameTag: jest.fn(),
  setTagColor: jest.fn(),
  deleteTag: jest.fn().mockResolvedValue(true),
  mergeTags: jest.fn(),
}))
