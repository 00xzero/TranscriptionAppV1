export const DELETE_TRANSCRIPT_ERROR_TITLE = 'Failed to delete transcript'
export const DELETE_TRANSCRIPT_ERROR_DESCRIPTION = 'Please try again.'
export const DELETE_TRANSCRIPT_ERROR_MESSAGE =
  `${DELETE_TRANSCRIPT_ERROR_TITLE}. ${DELETE_TRANSCRIPT_ERROR_DESCRIPTION}`

// The transcript is gone, but storage objects linked during the delete were left
// for the orphan cleanup tool.
export const TRANSCRIPT_CLEANUP_PENDING_TOAST = {
  title: 'Transcript deleted',
  description: 'Some files could not be removed and will be cleaned up later.',
} as const
