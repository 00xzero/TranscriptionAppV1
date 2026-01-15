import './globals.css'
import Link from 'next/link'
import type { Metadata } from 'next'
import ThemeToggle from '../components/ThemeToggle'
import AuthStatus from '../components/AuthStatus'

export const metadata: Metadata = {
  title: 'Transcription App',
  description: 'Lightweight transcription tool',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <header className="border-b border-base bg-surface">
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
        <main className="max-w-6xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  )
}
