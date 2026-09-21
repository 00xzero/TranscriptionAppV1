import { z } from 'zod'

export const UuidSchema = z.guid('Invalid UUID')
export const ProjectNameSchema = z.string().trim().min(1).max(80)

export function uuidString(message = 'Invalid UUID') {
  return z.guid(message)
}
