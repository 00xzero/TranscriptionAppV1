export function buildRecordingMicConstraints(deviceId: string | null): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
    channelCount: 1,
  }

  if (deviceId) {
    audio.deviceId = { exact: deviceId }
  }

  return { audio }
}
