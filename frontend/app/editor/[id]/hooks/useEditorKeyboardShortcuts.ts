import { useEffect } from 'react'

export function useEditorKeyboardShortcuts({
  togglePlay,
  seekRelative,
  openFindReplaceModal,
  openExportModal,
  handleReturnToTop,
}: {
  togglePlay: () => void
  seekRelative: (sec: number) => void
  openFindReplaceModal: (event?: WindowEventMap['open-find-replace']) => void
  openExportModal: (event?: WindowEventMap['open-export']) => void
  handleReturnToTop: (event?: WindowEventMap['editor-scroll-to-top']) => void
}) {
  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const isEditableTarget =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      const isInteractiveTarget = !!(e.target instanceof Element && e.target.closest(
        'button, a[href], select, [role="button"], [role="link"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
      ))
      const isAltGraph =
        e.getModifierState?.('AltGraph') ||
        (e.ctrlKey && e.altKey && !e.metaKey)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFindReplaceModal()
        return
      }
      if (!isEditableTarget && !e.altKey && !isAltGraph && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        openExportModal()
        return
      }
      if (isEditableTarget || isInteractiveTarget) return
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return }
      if (e.key.toLowerCase() === 'j') { seekRelative(-2); return }
      if (e.key.toLowerCase() === 'l') { seekRelative(2); return }
      if (e.key === ',') { seekRelative(-0.25); return }
      if (e.key === '.') { seekRelative(0.25); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekRelative, openFindReplaceModal, openExportModal])

  // Custom event listeners
  useEffect(() => {
    window.addEventListener('open-find-replace', openFindReplaceModal)
    window.addEventListener('open-export', openExportModal)
    window.addEventListener('editor-scroll-to-top', handleReturnToTop)
    return () => {
      window.removeEventListener('open-find-replace', openFindReplaceModal)
      window.removeEventListener('open-export', openExportModal)
      window.removeEventListener('editor-scroll-to-top', handleReturnToTop)
    }
  }, [handleReturnToTop, openFindReplaceModal, openExportModal])
}
