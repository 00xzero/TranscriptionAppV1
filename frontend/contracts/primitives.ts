import { z } from 'zod'

export const UuidSchema = z.guid('Invalid UUID')

export function uuidString(message = 'Invalid UUID') {
  return z.guid(message)
}
