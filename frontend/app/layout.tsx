import './globals.css'
import type { Metadata } from 'next'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import { createThemeInitScript } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Olivetti',
  description: 'Lightweight transcription tool',
}

// Runs before first paint to set the `.dark` class from the saved preference,
// avoiding a light-theme flash for dark/system users.
const themeInitScript = createThemeInitScript()

// The bare document every page shares. The app shell (providers, sidebar,
// header) lives in `(app)/layout.tsx`, so the sign-in page loads none of it.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased bg-noise">
        {children}
      </body>
    </html>
  )
}
