import './globals.css'
import Link from 'next/link'
import type { Metadata } from 'next'
import ThemeToggle from '../components/ThemeToggle'
import AuthStatus from '../components/AuthStatus'
import { Inter, Newsreader, IBM_Plex_Mono } from 'next/font/google'

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
  title: 'Transcription App',
  description: 'Lightweight transcription tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${newsreader.variable} ${ibmPlexMono.variable} bg-noise`}>
        <header className="border-b border-base bg-surface content-layer">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
            <Link href="/" className="font-semibold">Home</Link>
            <Link href="/upload">Upload</Link>
            <Link href="/import">Import</Link>
            <Link href="/projects">Projects</Link>
            <div className="ml-auto flex items-center gap-4">
              <AuthStatus />
              <ThemeToggle />
            </div>
          </nav>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6 content-layer">
          {children}
        </main>
      </body>
    </html>
  )
}
