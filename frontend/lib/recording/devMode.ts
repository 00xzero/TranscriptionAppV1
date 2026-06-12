const rawRecordingDevControls =
  process.env.NEXT_PUBLIC_RECORDING_DEV_CONTROLS?.toLowerCase()

export const RECORDING_DEV_CONTROLS_ENABLED =
  rawRecordingDevControls === 'true' || rawRecordingDevControls === '1'
