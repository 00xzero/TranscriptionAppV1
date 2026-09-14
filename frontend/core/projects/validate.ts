import { ProjectNameSchema } from '@/contracts/primitives'

export type ProjectNameValidation =
  | { valid: true; name: string }
  | { valid: false; error: string }

export function validateProjectName(name: string): ProjectNameValidation {
  const result = ProjectNameSchema.safeParse(name)
  if (result.success) return { valid: true, name: result.data }

  const issue = result.error.issues[0]
  if (issue?.code === 'too_small') return { valid: false, error: 'Enter a project name.' }
  if (issue?.code === 'too_big') {
    return { valid: false, error: 'Project names must be 80 characters or fewer.' }
  }
  return { valid: false, error: 'Enter a valid project name.' }
}
