export function buildRecordingMicConstraints(deviceId: string | null): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }

  if (deviceId) {
    audio.deviceId = { exact: deviceId }
  }

  return { audio }
}
