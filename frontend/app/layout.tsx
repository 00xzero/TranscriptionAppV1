import './globals.css'
import type { Metadata } from 'next'
import { Inter, Newsreader, IBM_Plex_Mono } from 'next/font/google'
import { ModalProvider } from '../lib/ModalContext'
import Sidebar from '../components/Sidebar'
import ContextualHeader from '../components/ContextualHeader'
import CaptureModal from '../components/CaptureModal'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Olivetti — Transcription App',
  description: 'Lightweight transcription tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${newsreader.variable} ${ibmPlexMono.variable} bg-noise h-screen flex overflow-hidden`}>
        <ModalProvider>
          <Sidebar />
          <main className="flex-1 flex flex-col relative overflow-hidden content-layer">
            <ContextualHeader />
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </main>
          <CaptureModal />
        </ModalProvider>
      </body>
    </html>
  )
}

