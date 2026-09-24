import { z } from 'zod'
import { TEXT_LIMITS } from './limits'

export const UuidSchema = z.guid('Invalid UUID')
export const ProjectNameSchema = z.string().trim().min(1).max(TEXT_LIMITS.projectName)

export function uuidString(message = 'Invalid UUID') {
  return z.guid(message)
}
