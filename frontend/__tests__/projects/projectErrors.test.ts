import { isProjectGoneError, mapProjectWriteError } from '@/lib/supabase/project-errors'

describe('project write errors', () => {
  test.each([
    ['23505', 'A project with that name already exists here.'],
    ['23503', 'That project no longer exists.'],
    ['PJ001', 'That project no longer exists.'],
    ['PJ002', 'That project is being deleted.'],
    ['other', 'Something went wrong. Please try again.'],
  ])('maps %s', (code, message) => {
    expect(mapProjectWriteError({ code })).toBe(message)
  })

  test('recognizes every database code that means the chosen project is gone', () => {
    expect(isProjectGoneError({ code: 'PJ001' })).toBe(true)
    expect(isProjectGoneError({ code: 'PJ002' })).toBe(true)
    expect(isProjectGoneError({ code: '23503' })).toBe(true)
    expect(isProjectGoneError({ code: '23505' })).toBe(false)
    expect(isProjectGoneError(new Error('network'))).toBe(false)
  })
})
