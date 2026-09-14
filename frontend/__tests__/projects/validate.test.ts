import { validateProjectName } from '@/core/projects/validate'

describe('validateProjectName', () => {
  test('returns the schema-trimmed name', () => {
    expect(validateProjectName('  Client work  ')).toEqual({ valid: true, name: 'Client work' })
  })

  test('maps blank and overlong names to user-facing messages', () => {
    expect(validateProjectName('   ')).toEqual({ valid: false, error: 'Enter a project name.' })
    expect(validateProjectName('x'.repeat(81))).toEqual({
      valid: false,
      error: 'Project names must be 80 characters or fewer.',
    })
  })
})
