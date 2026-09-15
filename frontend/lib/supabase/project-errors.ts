type DatabaseError = {
  code?: string | null
}

const PROJECT_DUPLICATE_MESSAGE = 'A project with that name already exists here.'
const PROJECT_MISSING_MESSAGE = 'That project no longer exists.'
const PROJECT_DELETING_MESSAGE = 'That project is being deleted.'
const PROJECT_GENERIC_MESSAGE = 'Something went wrong. Please try again.'

export type ProjectLinkWriteRejection = 'deleting' | 'gone'

export function getProjectErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof (error as DatabaseError).code === 'string' ? (error as DatabaseError).code! : null
}

export function classifyProjectLinkWriteRejection(
  error: unknown
): ProjectLinkWriteRejection | null {
  switch (getProjectErrorCode(error)) {
    case 'PJ002':
      return 'deleting'
    case 'PGRST116':
      return 'gone'
    default:
      return null
  }
}

export function mapProjectWriteError(error: unknown): string {
  switch (getProjectErrorCode(error)) {
    case '23505':
      return PROJECT_DUPLICATE_MESSAGE
    case '23503':
    case 'PJ001':
      return PROJECT_MISSING_MESSAGE
    case 'PJ002':
      return PROJECT_DELETING_MESSAGE
    default:
      return PROJECT_GENERIC_MESSAGE
  }
}

export function isProjectGoneError(error: unknown): boolean {
  return ['23503', 'PJ001', 'PJ002'].includes(getProjectErrorCode(error) ?? '')
}
