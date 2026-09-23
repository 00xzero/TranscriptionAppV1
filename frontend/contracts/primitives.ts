import { z } from 'zod'

export const UuidSchema = z.guid('Invalid UUID')
/** Mirrors the projects_name_length CHECK constraint in the projects migration. */
export const PROJECT_NAME_MAX_LENGTH = 80
export const ProjectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH)

export function uuidString(message = 'Invalid UUID') {
  return z.guid(message)
}
