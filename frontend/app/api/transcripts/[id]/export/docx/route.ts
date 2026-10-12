import { createExportHandler } from '@/lib/exports/route'

export const runtime = 'nodejs' // DOCX generation requires Node.js runtime

export const GET = createExportHandler('docx')
