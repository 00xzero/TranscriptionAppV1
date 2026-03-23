import { z } from 'zod'

export const CreateProjectBodySchema = z.object({
  title: z.string().max(500).optional(),
  filename: z.string().min(1, 'filename is required'),
  key_terms: z.array(z.string().max(100)).max(100).optional(),
})

export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>
