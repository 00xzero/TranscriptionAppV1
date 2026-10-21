/**
 * Frozen record of what a stored Deepgram response becomes: the words,
 * segments, text, timings and speakers handed to save_transcript_segments.
 * Taken before the pipeline was made engine-neutral; a change to this snapshot
 * means Deepgram transcripts come out differently, so it must never be updated
 * to make a refactor pass.
 *
 * The fixtures are made up (no real recordings) and come from
 * __tests__/fixtures/deepgram/.
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import type { SaveTranscriptSegmentsPayload } from '@/contracts/db'
import { getEngine } from '@/lib/transcription/engines.server'
import { buildRpcPayload } from '@/lib/transcription/segments-payload'

const FIXTURES = join(__dirname, 'fixtures', 'deepgram')

/** Stored response → segments payload, the way the webhook handler does it. */
function runPipeline(raw: string): SaveTranscriptSegmentsPayload {
  return buildRpcPayload(getEngine('deepgram').resultToWords(raw))
}

/** Segment ids are made fresh each run; everything else must match exactly. */
function comparable(payload: SaveTranscriptSegmentsPayload) {
  return {
    speakers: payload.speakers,
    segments: payload.segments.map((segment, index) => ({
      ...segment,
      id: `segment-${index}`,
      // One line per word keeps the snapshot readable.
      words: segment.words.map((word) => JSON.stringify(word)),
    })),
  }
}

describe('Deepgram pipeline baseline', () => {
  const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort()

  it('has fixtures to compare', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it.each(files)('%s', (name) => {
    const raw = readFileSync(join(FIXTURES, name), 'utf8')
    expect(comparable(runPipeline(raw))).toMatchSnapshot()
  })
})
