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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
