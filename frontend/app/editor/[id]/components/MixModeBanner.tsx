import React from 'react'

export default function MixModeBanner({ visible, collapsed }: { visible: boolean; collapsed: boolean }) {
  if (!visible) return null
  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-in-out ${collapsed ? 'max-h-0 opacity-0 my-0' : 'max-h-32 opacity-100 my-3'}`}
    >
      <div className="mx-6 bg-warm-highlight/30 dark:bg-warm-highlight/10 border border-ink/10 dark:border-paper/10 rounded-lg p-3 flex items-start gap-3">
        <svg className="w-5 h-5 text-ink/60 dark:text-paper/60 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-ink dark:text-paper">Mix Mode (Raw Segments)</h3>
          <p className="text-sm text-muted mt-1">
            Text editing is disabled because consolidation was skipped, but you can assign speakers.
          </p>
        </div>
      </div>
    </div>
  )
}
