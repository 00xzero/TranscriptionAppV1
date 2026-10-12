import { getDownloadFilename, normalizeDownloadTitle } from '@/lib/exports/filename'

describe('export filenames', () => {
  test.each([
    ['hello   world', 'hello_world'], ['会議メモ', '会議メモ'],
    ['Réunion d’équipe', 'Réunion_déquipe'], ['Re\u0301union', 'Réunion'],
    ['', 'Transcript'], [' !!! ', 'Transcript'],
    ['../notes\\today\r\n"draft"', 'notestoday_draft'],
  ])('normalizes %s', (title, expected) => {
    expect(normalizeDownloadTitle(title)).toBe(expected)
  })

  test('limits titles by Unicode code points without splitting surrogate pairs', () => {
    const title = '𐐀'.repeat(101)
    expect(normalizeDownloadTitle(title)).toBe('𐐀'.repeat(100))
  })

  test.each([
    ['attachment; filename="notes.txt"', 'notes.txt'],
    ['attachment; filename=notes.txt', 'notes.txt'],
    ['attachment; FILENAME = "notes; draft.txt"', 'notes; draft.txt'],
    ["attachment; filename=fallback.txt; filename*=UTF-8''%E4%BC%9A%E8%AD%B0.txt", '会議.txt'],
    ["attachment; filename*=utf-8'en'R%C3%A9union.txt; filename=fallback.txt", 'Réunion.txt'],
    ["attachment; filename*=UTF-8''bad%ZZ; filename=fallback.txt", 'fallback.txt'],
    ["attachment; filename*=UTF-8''%E4; filename=fallback.txt", 'fallback.txt'],
    ["attachment; filename*=UTF-8''; filename=fallback.txt", 'fallback.txt'],
    ["attachment; filename*=ISO-8859-1''notes; filename=fallback.txt", 'fallback.txt'],
    [null, null], ['attachment', null], ['attachment; filename=""', null],
  ])('reads %s', (header, expected) => {
    expect(getDownloadFilename(header)).toBe(expected)
  })
})
