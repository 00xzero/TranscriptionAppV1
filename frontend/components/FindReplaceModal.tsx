"use client"

import React, { useRef, useEffect, useState, useMemo, useId } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

export interface FindReplaceModalProps {
  open: boolean
  onClose: () => void
  // Search state
  findInput: string
  setFindInput: (v: string) => void
  findTerm: string
  replaceTerm: string
  setReplaceTerm: (v: string) => void
  caseSensitive: boolean
  setCaseSensitive: (v: boolean) => void
  wholeWord: boolean
  setWholeWord: (v: boolean) => void
  // Actions
  onNext: () => void
  onPrev: () => void
  onReplace: () => void
  onReplaceAll: () => void
  onFindKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onClear: () => void
  // Match state
  matchSummary: string
  canNavigate: boolean
  canReplace: boolean
  hasMatches: boolean
  // Match context for snippet list
  matches: Array<{ segId: string; index: number; length: number }>
  segments: Array<{ id: string; text: string }>
  matchIndex: number
  onMatchClick: (matchIdx: number) => void
}

interface MatchSnippet {
  before: string
  highlight: string
  after: string
  idx: number
  isCurrent: boolean
}

export default function FindReplaceModal({
  open,
  onClose,
  findInput,
  setFindInput,
  findTerm,
  replaceTerm,
  setReplaceTerm,
  caseSensitive,
  setCaseSensitive,
  wholeWord,
  setWholeWord,
  onNext,
  onPrev,
  onReplace,
  onReplaceAll,
  onFindKeyDown,
  onClear,
  matchSummary,
  canNavigate,
  canReplace,
  hasMatches,
  matches,
  segments,
  matchIndex,
  onMatchClick,
}: FindReplaceModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const snippetRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const [flashUp, setFlashUp] = useState(false)
  const [flashDown, setFlashDown] = useState(false)
  const [flashEsc, setFlashEsc] = useState(false)
  useFocusTrap(panelRef, open)

  // Auto-scroll the active snippet into view within the results container
  useEffect(() => {
    const el = snippetRefs.current[matchIndex]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [matchIndex, open])

  // ESC to close + body scroll lock
  useEffect(() => {
    if (!open) return

    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setFlashEsc(true)
        setTimeout(() => setFlashEsc(false), 150)
        setTimeout(() => onClose(), 80)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFlashUp(true)
        setTimeout(() => setFlashUp(false), 150)
        if (canNavigate) onPrev()
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFlashDown(true)
        setTimeout(() => setFlashDown(false), 150)
        if (canNavigate) onNext()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, onPrev, onNext, canNavigate])

  const segmentsById = useMemo(() => {
    const map = new Map<string, string>()
    for (const seg of segments) {
      map.set(seg.id, seg.text || '')
    }
    return map
  }, [segments])

  // Build match context snippets
  const snippets = useMemo(() => {
    return matches.reduce<MatchSnippet[]>((acc, m, i) => {
      const text = segmentsById.get(m.segId)
      if (text === undefined) return acc

      const ctxStart = Math.max(0, m.index - 30)
      const ctxEnd = Math.min(text.length, m.index + m.length + 30)
      const before = (ctxStart > 0 ? '...' : '') + text.slice(ctxStart, m.index)
      const highlight = text.slice(m.index, m.index + m.length)
      const after = text.slice(m.index + m.length, ctxEnd) + (ctxEnd < text.length ? '...' : '')

      acc.push({ before, highlight, after, idx: i, isCurrent: i === matchIndex })
      return acc
    }, [])
  }, [matches, segmentsById, matchIndex])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-100">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-paper/20 dark:bg-black/40 backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="flex justify-center pt-[20vh]">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative w-[600px] max-w-[90vw] bg-[#F2EFED]/45 dark:bg-[#1A1A1A]/45 backdrop-blur-md border border-[#D1CEC5] dark:border-[#333] rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id={titleId} className="sr-only">Find and Replace</h2>
          {/* Search row */}
          <div className="flex items-center gap-3 h-16 px-5 border-b border-[#D1CEC5]/60 dark:border-[#333]/60">
            {/* Search icon */}
            <svg className="w-4 h-4 text-ink/40 dark:text-paper/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="flex-1 bg-transparent border-none text-base font-serif italic text-ink dark:text-paper placeholder:text-ink/30 dark:placeholder:text-paper/30 focus:outline-hidden focus:ring-0"
              value={findInput}
              onChange={(e) => setFindInput(e.target.value)}
              onKeyDown={onFindKeyDown}
              placeholder="Search text"
              aria-label="Find text"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setCaseSensitive(!caseSensitive)}
              aria-pressed={caseSensitive}
              title={caseSensitive ? 'Disable match case' : 'Enable match case'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors select-none ${
                caseSensitive
                  ? 'bg-trust-blue/15 text-trust-blue border border-trust-blue/30 dark:bg-trust-blue/20 dark:text-trust-blue dark:border-trust-blue/40'
                  : 'text-ink/40 dark:text-paper/40 border border-ink/10 dark:border-paper/10 hover:bg-ink/5 dark:hover:bg-paper/5'
              }`}
            >
              <span className="font-serif italic text-xs">Aa</span>
              Match Case
            </button>
            <button
              type="button"
              onClick={() => setWholeWord(!wholeWord)}
              aria-pressed={wholeWord}
              title={wholeWord ? 'Disable whole word matching' : 'Enable whole word matching'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors select-none ${
                wholeWord
                  ? 'bg-trust-blue/15 text-trust-blue border border-trust-blue/30 dark:bg-trust-blue/20 dark:text-trust-blue dark:border-trust-blue/40'
                  : 'text-ink/40 dark:text-paper/40 border border-ink/10 dark:border-paper/10 hover:bg-ink/5 dark:hover:bg-paper/5'
              }`}
            >
              <span className="font-mono text-xs font-bold">W</span>
              Whole Word
            </button>
          </div>

          {/* Replace row — shown when canReplace and there's a find term */}
          {canReplace && findTerm && (
            <div className="flex items-center gap-3 h-14 px-5 border-b border-[#D1CEC5]/60 dark:border-[#333]/60">
              {/* Arrow icon */}
              <svg className="w-4 h-4 text-ink/30 dark:text-paper/30 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <input
                className="flex-1 bg-transparent border-none text-base font-serif italic text-ink dark:text-paper placeholder:text-ink/30 dark:placeholder:text-paper/30 focus:outline-hidden focus:ring-0"
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                placeholder="Replacement"
                aria-label="Replace with"
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-trust-blue text-white text-sm font-medium disabled:opacity-40 hover:bg-trust-blue/90 transition-colors"
                onClick={onReplace}
                disabled={!canNavigate}
                title="Replace current match"
              >
                Replace
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-trust-blue text-white text-sm font-medium disabled:opacity-40 hover:bg-trust-blue/90 transition-colors"
                onClick={onReplaceAll}
                disabled={!canNavigate}
                title="Replace all matches"
              >
                Replace all
              </button>
            </div>
          )}

          {/* Results */}
          {findTerm && (
            <div className="px-5 py-3 border-b border-[#D1CEC5]/60 dark:border-[#333]/60">
              {/* Match context snippets */}
              {snippets.length > 0 && canNavigate && (
                <div className="max-h-[300px] overflow-y-auto space-y-1">
                  {snippets.map((s) => {
                    return (
                      <button
                        key={s.idx}
                        type="button"
                        ref={(el) => { snippetRefs.current[s.idx] = el }}
                        title={s.isCurrent ? 'Current match' : 'Jump to this match'}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-mono leading-relaxed transition-colors ${s.isCurrent
                            ? 'bg-trust-blue/10 dark:bg-trust-blue/15 border border-trust-blue/30'
                            : 'hover:bg-ink/5 dark:hover:bg-paper/5 border border-transparent'
                          }`}
                        onClick={() => {
                          if (!canNavigate) return
                          onMatchClick(s.idx)
                          onClose()
                        }}
                      >
                        <span className="text-ink/60 dark:text-paper/50">{s.before}</span>
                        <span className="bg-warm-highlight text-ink dark:bg-trust-blue dark:text-white px-0.5 rounded-sm">{s.highlight}</span>
                        <span className="text-ink/60 dark:text-paper/50">{s.after}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between h-10 px-5 bg-ink/5 dark:bg-white/5 border-t border-[#D1CEC5] dark:border-white/10">
            <div className="flex items-center gap-2">
              {/* Up arrow */}
              <button
                type="button"
                onClick={onPrev}
                disabled={!canNavigate}
                aria-label="Previous match"
                title="Previous match"
                className={`w-7 h-7 rounded-md border flex items-center justify-center disabled:opacity-30 transition-colors ${
                  flashUp
                    ? 'bg-ink/10 dark:bg-paper/10 border-ink/20 dark:border-paper/20 text-ink/80 dark:text-paper/70'
                    : 'bg-ink/5 dark:bg-paper/5 border-ink/10 dark:border-paper/10 text-ink/60 dark:text-paper/50 hover:bg-ink/10 dark:hover:bg-paper/10'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                </svg>
              </button>
              {/* Down arrow */}
              <button
                type="button"
                onClick={onNext}
                disabled={!canNavigate}
                aria-label="Next match"
                title="Next match"
                className={`w-7 h-7 rounded-md border flex items-center justify-center disabled:opacity-30 transition-colors ${
                  flashDown
                    ? 'bg-ink/10 dark:bg-paper/10 border-ink/20 dark:border-paper/20 text-ink/80 dark:text-paper/70'
                    : 'bg-ink/5 dark:bg-paper/5 border-ink/10 dark:border-paper/10 text-ink/60 dark:text-paper/50 hover:bg-ink/10 dark:hover:bg-paper/10'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {/* Match summary */}
              <span
                data-testid="match-summary"
                className="text-[11px] font-mono text-ink/50 dark:text-paper/40 ml-1"
              >
                {matchSummary}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClear}
                title="Clear search"
                className="text-[11px] font-mono text-ink/40 dark:text-paper/40 hover:text-ink dark:hover:text-paper transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close find/replace (Esc)"
                title="Close (Esc)"
                className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                  flashEsc
                    ? 'bg-ink/10 dark:bg-paper/10 border-ink/20 dark:border-paper/20 text-ink/60 dark:text-paper/50'
                    : 'bg-ink/5 dark:bg-paper/5 border-ink/10 dark:border-paper/10 text-ink/40 dark:text-paper/30 hover:bg-ink/10 dark:hover:bg-paper/10'
                }`}
              >
                ESC
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
