import './globals.css'
import type { Metadata } from 'next'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { ModalProvider } from '@/lib/ModalContext'
import { RecordingSessionProvider } from '@/lib/recording/RecordingSessionContext'
import Sidebar from '@/components/Sidebar'
import ContextualHeader from '@/components/ContextualHeader'
import CaptureModal from '@/components/CaptureModal'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { PROJECT_ARCHIVE_COLLAPSED_KEY, SIDEBAR_COLLAPSED_KEY } from '@/lib/constants'
import { createThemeInitScript } from '@/lib/theme'
import { ProjectsProvider } from '@/lib/projects/ProjectsProvider'

export const metadata: Metadata = {
  title: 'Olivetti',
  description: 'Lightweight transcription tool',
}

// Runs before first paint to set the `.dark` class from the saved preference,
// avoiding a light-theme flash for dark/system users.
const themeInitScript = createThemeInitScript()

// Navigation widths are persisted in localStorage, which React cannot read
// during SSR. Seed CSS-only shell variables before the first body paint so the
// static shells match their saved widths while the client hydrates.
const sidebarInitScript = `
  try {
    var sidebarCollapsed = localStorage.getItem('${SIDEBAR_COLLAPSED_KEY}') === 'true';
    var projectArchiveCollapsed = localStorage.getItem('${PROJECT_ARCHIVE_COLLAPSED_KEY}') === 'true';
    document.documentElement.style.setProperty('--sidebar-initial-width', sidebarCollapsed ? '3.5rem' : '16rem');
    document.documentElement.style.setProperty('--sidebar-initial-label-opacity', sidebarCollapsed ? '0' : '1');
    document.documentElement.style.setProperty('--sidebar-initial-inline-padding', sidebarCollapsed ? '0.5rem' : '0.75rem');
    document.documentElement.style.setProperty('--sidebar-initial-account-padding', sidebarCollapsed ? '0.25rem' : '0.5rem');
    document.documentElement.style.setProperty('--project-archive-initial-width', projectArchiveCollapsed ? '3.125rem' : '18rem');
    document.documentElement.style.setProperty('--project-archive-initial-margin', projectArchiveCollapsed ? '-0.5rem' : '0rem');
    document.documentElement.style.setProperty('--project-archive-initial-expanded-display', projectArchiveCollapsed ? 'none' : 'block');
    document.documentElement.style.setProperty('--project-archive-initial-expanded-flex', projectArchiveCollapsed ? 'none' : 'flex');
    document.documentElement.style.setProperty('--project-archive-initial-collapsed-flex', projectArchiveCollapsed ? 'flex' : 'none');
  } catch (_) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body className="antialiased bg-noise h-screen flex overflow-hidden">
        <TooltipProvider delayDuration={700}>
          <AuthProvider>
            <ModalProvider>
              <ProjectsProvider>
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
              </ProjectsProvider>
            </ModalProvider>
          </AuthProvider>
        </TooltipProvider>
      </body>
    </html>
  )
}
