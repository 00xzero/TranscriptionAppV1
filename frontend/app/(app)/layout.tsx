import { AuthProvider } from '@/lib/auth/AuthProvider'
import { ModalProvider } from '@/lib/ModalContext'
import { RecordingSessionProvider } from '@/lib/recording/RecordingSessionContext'
import Sidebar from '@/components/Sidebar'
import ContextualHeader from '@/components/ContextualHeader'
import CaptureModal from '@/components/CaptureModal'
import AccountChangedScreen, { CurrentAccountOnly } from '@/components/AccountChangedScreen'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { PROJECT_ARCHIVE_COLLAPSED_KEY, SIDEBAR_COLLAPSED_KEY } from '@/lib/constants'
import { ProjectsProvider } from '@/lib/projects/ProjectsProvider'

// Navigation widths are persisted in localStorage, which React cannot read
// during SSR. Seed CSS-only shell variables before the sidebar paints so the
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

// The app shell around every signed-in page. The init script comes first so
// it runs while the HTML is parsed, before the sidebar below it paints.
// Once the page's account changes in another tab, everything inside
// CurrentAccountOnly unmounts, so nothing keeps fetching or showing the old
// account; the recording (which outlives pages) and the cover stay.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      <div className="h-screen flex overflow-hidden">
        <TooltipProvider delayDuration={700}>
          <AuthProvider>
            <ModalProvider>
              <RecordingSessionProvider>
                <CurrentAccountOnly>
                  <ProjectsProvider>
                    <Sidebar />
                    <main className="flex-1 relative overflow-hidden z-[1]">
                      <div className="pointer-events-none absolute top-0 left-0 right-3">
                        <ContextualHeader />
                      </div>
                      <div className="app-scroll-root h-full w-full overflow-y-auto [scrollbar-gutter:stable]">
                        {children}
                      </div>
                    </main>
                    <CaptureModal />
                  </ProjectsProvider>
                </CurrentAccountOnly>
                <Toaster />
                <AccountChangedScreen />
              </RecordingSessionProvider>
            </ModalProvider>
          </AuthProvider>
        </TooltipProvider>
      </div>
    </>
  )
}
