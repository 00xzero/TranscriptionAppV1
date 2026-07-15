import './globals.css'
import type { Metadata } from 'next'
import { Inter, Newsreader, IBM_Plex_Mono } from 'next/font/google'
import { ModalProvider } from '@/lib/ModalContext'
import { RecordingSessionProvider } from '@/lib/recording/RecordingSessionContext'
import Sidebar from '@/components/Sidebar'
import ContextualHeader from '@/components/ContextualHeader'
import CaptureModal from '@/components/CaptureModal'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { SIDEBAR_COLLAPSED_KEY } from '@/lib/constants'
import { createThemeInitScript } from '@/lib/theme'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Olivetti',
  description: 'Lightweight transcription tool',
}

// Runs before first paint to set the `.dark` class from the saved preference,
// avoiding a light-theme flash for dark/system users.
const themeInitScript = createThemeInitScript()

// Sidebar width is persisted in localStorage, which React cannot read during
// SSR. Set CSS-only shell variables before the first body paint so the static
// sidebar shell matches the saved width while the client hydrates.
const sidebarInitScript = `
  try {
    var sidebarCollapsed = localStorage.getItem('${SIDEBAR_COLLAPSED_KEY}') === 'true';
    document.documentElement.style.setProperty('--sidebar-initial-width', sidebarCollapsed ? '3.5rem' : '16rem');
    document.documentElement.style.setProperty('--sidebar-initial-label-opacity', sidebarCollapsed ? '0' : '1');
    document.documentElement.style.setProperty('--sidebar-initial-inline-padding', sidebarCollapsed ? '0.5rem' : '0.75rem');
    document.documentElement.style.setProperty('--sidebar-initial-account-padding', sidebarCollapsed ? '0.25rem' : '0.5rem');
  } catch (_) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body className={`${inter.variable} ${newsreader.variable} ${ibmPlexMono.variable} antialiased bg-noise h-screen flex overflow-hidden`}>
        <TooltipProvider delayDuration={700}>
          <ModalProvider>
            <RecordingSessionProvider>
              <Sidebar />
              <main className="flex-1 relative overflow-hidden z-[1]">
                <div className="absolute top-0 left-0 right-3 z-40">
                  <ContextualHeader />
                </div>
                <div className="app-scroll-root h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
                  {children}
                </div>
              </main>
              <CaptureModal />
              <Toaster />
            </RecordingSessionProvider>
          </ModalProvider>
        </TooltipProvider>
      </body>
    </html>
  )
}
