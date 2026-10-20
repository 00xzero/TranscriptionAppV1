/**
 * The app's public address as transcription engines reach it: their callbacks
 * and, in local dev, the media proxy. An explicit tunnel (DEEPGRAM_CALLBACK_URL,
 * named for the first engine) wins over NEXT_PUBLIC_APP_URL. Null when neither
 * is set.
 */
export function getPublicBaseUrl(): string | null {
    const tunnel = process.env.DEEPGRAM_CALLBACK_URL
    if (tunnel) return tunnel.replace('/api/webhooks/deepgram', '').replace(/\/$/, '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    return appUrl ? appUrl.replace(/\/$/, '') : null
}
