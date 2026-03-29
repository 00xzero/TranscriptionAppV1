const allowedDevOrigins = ['localhost', '127.0.0.1']

if (process.env.DEEPGRAM_CALLBACK_URL) {
  try {
    allowedDevOrigins.push(new URL(process.env.DEEPGRAM_CALLBACK_URL).host)
  } catch {
    // Ignore malformed callback URLs in local development.
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [...new Set(allowedDevOrigins)],
}

export default nextConfig
