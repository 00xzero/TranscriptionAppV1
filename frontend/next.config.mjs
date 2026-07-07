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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=()',
          },
        ],
      },
    ]
  },
  // Native binaries — must not go through bundler. NFT still traces them into
  // the function's deployment artifact at runtime.
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'],
}

export default nextConfig
