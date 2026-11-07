/**
 * What the editor renders, and how long it takes, on a 10-hour transcript
 * (5,000 segments, 100,000 words), through the real virtualised list.
 *
 * Card renders are counted where every card render passes: its word-index
 * hook. Set EDITOR_RENDER_REPORT=1 to print the measurements.
 */
import React, { Profiler } from 'react'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import { VirtuosoMockContext } from 'react-virtuoso'
import EditorScreen from '../../app/(app)/editor/[id]/EditorScreen'
import * as supabaseQueries from '../../lib/supabase/queries'
import { TooltipProvider } from '../../components/ui/tooltip'
import { makeTranscript, projectProviderData, transcriptProviderData } from '../projects/fixtures'
import { LONG_TRANSCRIPT_ID, makeLongTranscript } from '../helpers/longTranscript'

// The real list, not the render-everything mock: virtualisation is what keeps
// a long transcript cheap, so the count must go through it.
jest.mock('react-virtuoso', () => jest.requireActual('../../node_modules/react-virtuoso/dist/index.cjs'))

const mockCounts = { cards: 0, screen: 0, byStartMs: new Map<number, number>() }
jest.mock('@/app/(app)/editor/[id]/hooks/useEditorKeyboardShortcuts', () => {
  const actual = jest.requireActual<typeof import('@/app/(app)/editor/[id]/hooks/useEditorKeyboardShortcuts')>('@/app/(app)/editor/[id]/hooks/useEditorKeyboardShortcuts')
  return {
    useEditorKeyboardShortcuts: (args: Parameters<typeof actual.useEditorKeyboardShortcuts>[0]) => {
      mockCounts.screen++
      return actual.useEditorKeyboardShortcuts(args)
    },
  }
})
jest.mock('@/app/(app)/editor/[id]/hooks/useCurrentWordIndex', () => {
  const actual = jest.requireActual<typeof import('@/app/(app)/editor/[id]/hooks/useCurrentWordIndex')>('@/app/(app)/editor/[id]/hooks/useCurrentWordIndex')
  return {
    useCurrentWordIndex: (args: Parameters<typeof actual.useCurrentWordIndex>[0]) => {
      mockCounts.cards++
      // In this fixture each segment starts with a timed word at its own start.
      const start = args.tokens[0]?.startMs
      if (start !== undefined) mockCounts.byStartMs.set(start, (mockCounts.byStartMs.get(start) ?? 0) + 1)
      return actual.useCurrentWordIndex(args)
    },
  }
})

// A player the test drives: its props are the editor's audio callbacks.
// EDITOR_RENDER_SEGMENTS sizes the transcript (7.2 s per segment, as for 10 hours).
const SEGMENTS = Number(process.env.EDITOR_RENDER_SEGMENTS) || 5000
const DURATION_SECS = SEGMENTS * 7.2
const mockAudio: { props: Record<string, any> | null; time: number } = { props: null, time: 0 }
function mockPlayerModule() {
  const React = jest.requireActual('react')
  const Player = React.forwardRef(function Player(props: Record<string, any>, ref: React.Ref<unknown>) {
    mockAudio.props = props
    React.useImperativeHandle(ref, () => ({
      getCurrentTime: () => mockAudio.time,
      getDuration: () => DURATION_SECS,
      isPlaying: () => false,
      isReady: () => true,
      getAudioElement: () => null,
      seekToMs: (ms: number) => { mockAudio.time = ms / 1000; props.onTimeUpdate?.(mockAudio.time); props.onSeeked?.() },
      seekToFraction: () => {}, seekRelative: () => {}, setPlaybackRate: () => {},
      play: () => {}, pause: () => {}, togglePlay: () => {},
      beginScrub: () => {}, scrubToFraction: () => {}, endScrub: () => {},
    }), [props])
    React.useEffect(() => {
      props.onDurationChange?.(DURATION_SECS)
      props.onReady?.()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return React.createElement('div', { 'data-testid': 'audio-player' })
  })
  return { __esModule: true, default: Player }
}
// Whichever way the editor's import resolves: to the player, or to the
// shared player mock.
jest.mock('@/components/AudioPlayer', mockPlayerModule)
jest.mock('../../__mocks__/AudioPlayer', mockPlayerModule)

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => projectProviderData([]),
  useTranscriptsData: () => transcriptProviderData([makeTranscript({ id: LONG_TRANSCRIPT_ID, title: 'Long meeting' })]),
}))
jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))

const REPORT = process.env.EDITOR_RENDER_REPORT === '1'
const fixture = makeLongTranscript({ segmentCount: SEGMENTS, durationSecs: DURATION_SECS })
const report: Record<string, string | number> = {}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const round = (n: number) => Math.round(n * 10) / 10

function mockLongTranscript() {
  const q = supabaseQueries as jest.Mocked<typeof supabaseQueries>
  q.fetchTranscriptData.mockResolvedValue({ items: fixture.segments })
  q.fetchSegmentWordSets.mockResolvedValue(fixture.wordSets as never)
  q.fetchSpeakers.mockResolvedValue(fixture.speakers)
  q.fetchTranscriptById.mockResolvedValue(makeTranscript({
    id: LONG_TRANSCRIPT_ID,
    user_id: fixture.speakers[0].user_id,
    title: 'Long meeting',
    duration_seconds: DURATION_SECS,
  }))
  // @ts-expect-error a fetch that answers only the media URL
  global.fetch = jest.fn(async (input: string) => ({
    ok: String(input).includes('/media-url'),
    status: String(input).includes('/media-url') ? 200 : 404,
    json: async () => ({ url: 'http://example.com/long.m4a' }),
  }))
}

// React's own render time for each commit under the editor.
let commitMs = 0
let commits = 0
let longest = 0
const onRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  commitMs += actualDuration
  commits++
  longest = Math.max(longest, actualDuration)
}

async function renderLongEditor() {
  mockLongTranscript()
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 900, itemHeight: 110 }}>
      <TooltipProvider delayDuration={0}>
        <Profiler id="editor" onRender={onRender}>
          <EditorScreen transcriptId={LONG_TRANSCRIPT_ID} />
        </Profiler>
      </TooltipProvider>
    </VirtuosoMockContext.Provider>
  )
  await screen.findAllByTestId('segment-card')
  // Words arrive after the segments; wait for the active card's highlight path.
  await waitFor(() => expect(supabaseQueries.fetchSegmentWordSets).toHaveBeenCalled())
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
}

/** Card renders and React render time for what `run` does. */
async function measure(run: () => Promise<void> | void) {
  mockCounts.cards = 0
  mockCounts.screen = 0
  mockCounts.byStartMs.clear()
  commitMs = 0
  commits = 0
  longest = 0
  const started = performance.now()
  await run()
  return { cards: mockCounts.cards, screen: mockCounts.screen, byStartMs: new Map(mockCounts.byStartMs), reactMs: commitMs, commits, longestMs: longest, wallMs: performance.now() - started }
}

describe('editor render cost on a 10-hour transcript', () => {
  beforeEach(() => { mockAudio.time = 0 })
  afterAll(() => {
    if (REPORT) console.log(`\nEditor render cost (${fixture.segments.length} segments, ${fixture.wordSets.length * 20} words)\n` +
      Object.entries(report).map(([k, v]) => `  ${k.padEnd(52)} ${v}`).join('\n'))
  })

  test('mounted cards', async () => {
    await renderLongEditor()
    report['cards mounted'] = screen.getAllByTestId('segment-card').length
  })

  test('typing in one segment', async () => {
    await renderLongEditor()
    const first = screen.getAllByTestId('segment-card')[0]
    fireEvent.click(within(first).getByRole('button', { name: /Edit transcript text/ }))
    const field = await within(first).findByRole('textbox')
    const perKey: Awaited<ReturnType<typeof measure>>[] = []
    for (let i = 0; i < 20; i++) {
      const value = (field as HTMLTextAreaElement).value + 'x'
      perKey.push(await measure(() => { fireEvent.change(field, { target: { value } }) }))
    }
    report['typing: card renders per keystroke'] = median(perKey.map((m) => m.cards))
    report['typing: EditorScreen calls per keystroke'] = median(perKey.map((m) => m.screen))
    report['typing: subtree commits per keystroke'] = median(perKey.map((m) => m.commits))
    report['typing: React render ms per keystroke (median)'] = round(median(perKey.map((m) => m.reactMs)))
    report['typing: wall ms per keystroke (median, jsdom)'] = round(median(perKey.map((m) => m.wallMs)))
    // The pause after typing: the save goes out, then "Saved", then idle.
    const settle = await measure(async () => {
      await act(async () => { await new Promise((r) => setTimeout(r, 1500)) })
    })
    report['typing: card renders for the save after a pause'] = settle.cards
  })

  test.each([10, 4])('one second of playback at %i ticks', async (ticks) => {
    await renderLongEditor()
    const second = await measure(async () => {
      act(() => { mockAudio.props!.onPlayingChange(true) })
      for (let i = 1; i <= ticks; i++) {
        mockAudio.time = 30 + i / ticks
        act(() => { mockAudio.props!.onTimeUpdate(mockAudio.time) })
        await act(async () => { await new Promise((r) => setTimeout(r, 1000 / ticks)) })
      }
      act(() => { mockAudio.props!.onPlayingChange(false) })
    })
    report['playback ' + ticks + ' Hz: card renders'] = second.cards
    report['playback ' + ticks + ' Hz: React render ms'] = round(second.reactMs)
    report['playback ' + ticks + ' Hz: subtree commits'] = second.commits
    report['playback ' + ticks + ' Hz: EditorScreen calls'] = second.screen
  })

  test('scrubbing', async () => {
    await renderLongEditor()
    act(() => { mockAudio.props!.onSeekStart?.() })
    const moves: Awaited<ReturnType<typeof measure>>[] = []
    for (let i = 1; i <= 20; i++) {
      const t = 20 + i * 0.5
      moves.push(await measure(() => {
        act(() => {
          mockAudio.props!.onScrubPreviewFraction(t / DURATION_SECS)
          mockAudio.props!.onScrubPreview(t)
        })
      }))
    }
    act(() => { mockAudio.props!.onSeekEnd?.() })
    report['scrub: card renders per pointer move'] = median(moves.map((m) => m.cards))
    report['scrub: EditorScreen calls per move'] = median(moves.map((m) => m.screen))
    report['scrub: React render ms per pointer move (median)'] = round(median(moves.map((m) => m.reactMs)))
  })

  test('user scrolling through virtual rows', async () => {
    await renderLongEditor()
    const ids = () => new Set(screen.getAllByTestId('segment-card').map((card) => card.dataset.segmentId))
    const container = screen.getAllByTestId('segment-card')[0].closest<HTMLElement>('.overflow-auto')!
    const moves = []
    for (let i = 1; i <= 10; i++) {
      const before = ids()
      const result = await measure(() => {
        fireEvent.wheel(container, { deltaY: 220 })
        fireEvent.scroll(container, { target: { scrollTop: i * 220 } })
      })
      const after = ids()
      const entered = [...after].filter((id) => !before.has(id)).length
      const retained = fixture.segments.filter((row) => before.has(row.id) && after.has(row.id))
      moves.push({ ...result, entered, retainedRenders: retained.reduce(
        (count, row) => count + (result.byStartMs.get(row.start_ms) ?? 0), 0
      ) })
    }
    report['scroll: EditorScreen calls per move'] = median(moves.map((move) => move.screen))
    report['scroll: new rows across moves'] = moves.reduce((n, move) => n + move.entered, 0)
    report['scroll: retained card renders across moves'] = moves.reduce((n, move) => n + move.retainedRenders, 0)
    expect(report['scroll: new rows across moves']).toBeGreaterThan(0)
  })

  test('Replace All on a common word', async () => {
    await renderLongEditor()
    act(() => { window.dispatchEvent(new CustomEvent('open-find-replace')) })
    const find = await screen.findByPlaceholderText(/Search text/i)
    const search = await measure(() => {
      fireEvent.change(find, { target: { value: 'the' } })
      fireEvent.keyDown(find, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByTestId('match-summary')).toHaveTextContent(/of [\d,]+ matches/))
    const summary = screen.getByTestId('match-summary').textContent
    report['find "the": matches'] = summary ?? ''
    report['find "the": wall ms to show matches (jsdom)'] = round(search.wallMs)
    fireEvent.change(screen.getByPlaceholderText('Replacement'), { target: { value: 'a' } })
    const setTexts = supabaseQueries.setSegmentTexts as jest.Mock
    setTexts.mockClear()
    const replace = await measure(() => {
      fireEvent.click(screen.getByTitle('Replace all matches'))
    })
    report['Replace All: wall ms on the main thread (jsdom)'] = round(replace.wallMs)
    report['Replace All: React render ms'] = round(replace.reactMs)
    report['Replace All: card renders'] = replace.cards
    // The save goes out, then "Saved" shows for 1.2 s per segment, each on
    // its own timer.
    const after = await measure(async () => {
      await act(async () => { await new Promise((r) => setTimeout(r, 8000)) })
    })
    report['Replace All: save requests'] = setTexts.mock.calls.length
    report['Replace All: segments in the save'] = setTexts.mock.calls.reduce((n, [edits]) => n + edits.length, 0)
    report['Replace All: subtree commits in the 8 s after'] = after.commits
    report['Replace All: EditorScreen calls in the 8 s after'] = after.screen
    report['Replace All: React render ms in the 8 s after'] = round(after.reactMs)
    report['Replace All: longest single render in the 8 s after'] = round(after.longestMs)
    report['Replace All: wall ms of the 8 s after (jsdom)'] = round(after.wallMs)
  }, 120000)
})
