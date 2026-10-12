/** @jest-environment node */

import { createClient } from '@/infra/supabase/server'
import { fetchExportData, type ExportData } from '@/lib/supabase/export-data'
import { generateDocx, generateMarkdown, generateTxt, generateVtt } from '@/core/exports'
import { getDownloadFilename } from '@/lib/exports/filename'
import { GET as docx, runtime } from '@/app/api/transcripts/[id]/export/docx/route'
import { GET as md } from '@/app/api/transcripts/[id]/export/md/route'
import { GET as txt } from '@/app/api/transcripts/[id]/export/txt/route'
import { GET as vtt } from '@/app/api/transcripts/[id]/export/vtt/route'
import { makeTranscript } from '../projects/fixtures'

jest.mock('@/infra/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/supabase/export-data', () => ({ fetchExportData: jest.fn() }))
jest.mock('@/core/exports', () => ({
  ...jest.requireActual('@/core/exports'),
  generateDocx: jest.fn(), generateMarkdown: jest.fn(), generateTxt: jest.fn(), generateVtt: jest.fn(),
}))

const routes = [
  { format: 'docx', GET: docx, render: generateDocx, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { format: 'md', GET: md, render: generateMarkdown, type: 'text/markdown; charset=utf-8' },
  { format: 'txt', GET: txt, render: generateTxt, type: 'text/plain; charset=utf-8' },
  { format: 'vtt', GET: vtt, render: generateVtt, type: 'text/vtt; charset=utf-8' },
]
const supabase = {}
const data: ExportData = {
  transcript: makeTranscript({ title: 'Team notes', created_at: '2026-10-11T12:00:00Z', duration_seconds: 65 }),
  exportSegments: [{ speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'Hello' }],
  speakers: { labels: new Map([['s1', 'Alice']]), identityKeys: new Map([['s1', 's1']]), identities: [], usedSpeakerIds: ['s1'], participants: [] },
}
const request = new Request('http://localhost/api/transcripts/p1/export/md') as Parameters<typeof md>[0]
const context = { params: Promise.resolve({ id: 'p1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(createClient).mockResolvedValue(supabase as Awaited<ReturnType<typeof createClient>>)
  jest.mocked(fetchExportData).mockResolvedValue({ success: true, data })
  jest.mocked(generateDocx).mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  jest.mocked(generateMarkdown).mockReturnValue('markdown output')
  jest.mocked(generateTxt).mockReturnValue('text output')
  jest.mocked(generateVtt).mockReturnValue('WEBVTT output')
})

describe.each(routes)('$format export route', ({ format, GET, render, type }) => {
  test('dispatches its renderer and returns an attachment', async () => {
    const response = await GET(request, context)
    expect(response.status).toBe(200)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(fetchExportData).toHaveBeenCalledWith(supabase, 'p1')
    expect(response.headers.get('Content-Type')).toBe(type)
    const disposition = response.headers.get('Content-Disposition')!
    const filename = `Team_notes_${format.toUpperCase()}_2026-10-11.${format}`
    expect(disposition).toContain(`filename="${filename}"`)
    expect(getDownloadFilename(disposition)).toBe(filename)
    expect(render).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith(format === 'vtt' ? {
      segments: data.exportSegments, speakers: data.speakers, transcriptId: 'p1',
    } : {
      transcriptTitle: 'Team notes', segments: data.exportSegments, speakers: data.speakers,
      transcriptionDate: new Date(data.transcript.created_at), durationSeconds: 65,
    })
    for (const route of routes) if (route.format !== format) expect(route.render).not.toHaveBeenCalled()
    if (format === 'docx') {
      expect(runtime).toBe('nodejs')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    } else {
      expect(await response.text()).toBe(format === 'md' ? 'markdown output' : format === 'txt' ? 'text output' : 'WEBVTT output')
    }
  })

  test.each([401, 404, 500])('preserves %s errors without rendering', async (status) => {
    jest.mocked(fetchExportData).mockResolvedValue({ success: false, error: { status, error: 'Export unavailable' } })
    const response = await GET(request, context)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'Export unavailable' })
    expect(response.headers.has('Content-Disposition')).toBe(false)
    for (const route of routes) expect(route.render).not.toHaveBeenCalled()
  })
})

test.each([
  ['会議メモ', '会議メモ', 'Transcript'],
  ['Réunion d’équipe', 'Réunion_déquipe', 'Runion_dquipe'],
  ['', 'Transcript', 'Transcript'],
  ['!!!', 'Transcript', 'Transcript'],
  ['a'.repeat(101), 'a'.repeat(100), 'a'.repeat(100)],
  ['../notes\\today', 'notestoday', 'notestoday'],
])('exports the Unicode name with an ASCII fallback for %s', async (title, preferred, fallback) => {
  jest.mocked(fetchExportData).mockResolvedValue({ success: true, data: {
    ...data, transcript: { ...data.transcript, title },
  } })
  const response = await md(request, context)
  const disposition = response.headers.get('Content-Disposition')!
  expect(disposition).toContain(`filename="${fallback}_MD_2026-10-11.md"`)
  expect(getDownloadFilename(disposition)).toBe(`${preferred}_MD_2026-10-11.md`)
})
