"use client"

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { useDialogFocusRestore } from '@/components/ui/use-dialog-focus-restore'

export interface FindReplaceModalProps {
  open: boolean
  onClose: () => void
  findInput: string
  setFindInput: (v: string) => void
  findTerm: string
  replaceTerm: string
  setReplaceTerm: (v: string) => void
  caseSensitive: boolean
  setCaseSensitive: (v: boolean) => void
  wholeWord: boolean
  setWholeWord: (v: boolean) => void
  onNext: () => void
  onPrev: () => void
  onReplace: () => void
  onReplaceAll: () => void
  onFindKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onClear: () => void
  matchSummary: string
  canNavigate: boolean
  /** False while replacing must wait; the buttons are disabled, not hidden. */
  canReplace: boolean
  matches: Array<{ segId: string; index: number; length: number }>
  segments: Array<{ id: string; text: string }>
  matchIndex: number
  onMatchClick: (matchIdx: number) => void
}

const MAX_RESULT_HEIGHT = 300

/** Move a snippet edge outward so it never splits a surrogate pair. */
function snippetEdge(text: string, at: number, direction: -1 | 1) {
  const high = text.charCodeAt(at - 1)
  const low = text.charCodeAt(at)
  const splitsPair = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
  return splitsPair ? at + direction : at
}

function FindResults({ matches, segments, matchIndex, onMatchClick }: Pick<
  FindReplaceModalProps, 'matches' | 'segments' | 'matchIndex' | 'onMatchClick'
>) {
  const listRef = useRef<VirtuosoHandle>(null)
  const index = Math.min(matchIndex, matches.length - 1)
  const previous = useRef({ index, matches })
  const [height, setHeight] = useState(MAX_RESULT_HEIGHT)
  const textById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment.text])), [segments])

  useEffect(() => {
    const changed = previous.current.index !== index || previous.current.matches !== matches
    previous.current = { index, matches }
    if (changed && index >= 0) listRef.current?.scrollToIndex({ index, align: 'center' })
  }, [index, matches])

  return (
    <Virtuoso
      ref={listRef}
      data={matches}
      initialTopMostItemIndex={index > 0 ? { index, align: 'center' } : undefined}
      totalListHeightChanged={(total) => { if (total > 0) setHeight(Math.min(MAX_RESULT_HEIGHT, total)) }}
      style={{ height }}
      className="scrollbar-thin"
      itemContent={(i, match) => {
        const text = textById.get(match.segId) ?? ''
        const end = match.index + match.length
        const from = snippetEdge(text, Math.max(0, match.index - 30), -1)
        const to = snippetEdge(text, Math.min(text.length, end + 30), 1)
        const current = i === index
        return (
          <div className="pb-1">
            <button
              type="button"
              title={current ? 'Current match' : 'Jump to this match'}
              aria-current={current || undefined}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-mono leading-relaxed transition-colors ${current
                ? 'border-trust-blue/30 bg-trust-blue/10 dark:bg-trust-blue/15'
                : 'border-transparent hover:bg-ink/5 dark:hover:bg-paper/5'
                }`}
              onClick={() => onMatchClick(i)}
            >
              <span className="text-ink/60 dark:text-paper/50">{from > 0 ? '...' : ''}{text.slice(from, match.index)}</span>
              <span className="rounded-sm bg-warm-highlight px-0.5 text-ink dark:bg-trust-blue dark:text-solid-foreground">{text.slice(match.index, end)}</span>
              <span className="text-ink/60 dark:text-paper/50">{text.slice(end, to)}{to < text.length ? '...' : ''}</span>
            </button>
          </div>
        )
      }}
    />
  )
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
  matches,
  segments,
  matchIndex,
  onMatchClick,
}: FindReplaceModalProps) {
  const { captureFocus, restoreFocus } = useDialogFocusRestore()
  const wasOpenRef = useRef(false)
  const restoreOnExternalCloseRef = useRef(true)
  const [flashUp, setFlashUp] = useState(false)
  const [flashDown, setFlashDown] = useState(false)
  const [flashEsc, setFlashEsc] = useState(false)

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      restoreOnExternalCloseRef.current = true
      captureFocus()
    }
  }, [open, captureFocus])

  useEffect(() => {
    if (!open && wasOpenRef.current && restoreOnExternalCloseRef.current) {
      restoreFocus()
    }

    wasOpenRef.current = open
  }, [open, restoreFocus])

  const handleClose = (options?: FocusOptions) => {
    restoreOnExternalCloseRef.current = false
    onClose()
    restoreFocus(options)
  }

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
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
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onPrev, onNext, canNavigate])


  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose()
        }
      }}
    >
      <DialogContent
        className="w-[600px] overflow-hidden p-0"
        aria-describedby={undefined}
        overlayClassName="dark:bg-scrim-soft"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          setFlashEsc(true)
          setTimeout(() => setFlashEsc(false), 150)
          setTimeout(() => handleClose(), 80)
        }}
      >
        <DialogTitle className="sr-only">Find and Replace</DialogTitle>

        <div className="flex h-16 items-center gap-3 border-b border-(--border)/60 px-5">
          <svg className="h-4 w-4 shrink-0 text-ink/40 dark:text-paper/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            className="flex-1 bg-transparent border-none text-base font-serif italic text-ink placeholder:text-ink/30 focus:outline-hidden focus:ring-0 dark:text-paper dark:placeholder:text-paper/30"
            value={findInput}
            onChange={(e) => setFindInput(e.target.value)}
            onKeyDown={onFindKeyDown}
            placeholder="Search text"
            aria-label="Find text"
            autoFocus
          />
          <Toggle
            pressed={caseSensitive}
            onPressedChange={setCaseSensitive}
            aria-label="Match case"
            variant="outline"
          >
            <span className="mr-1.5 font-serif text-xs italic">Aa</span>
            Match Case
          </Toggle>
          <Toggle
            pressed={wholeWord}
            onPressedChange={setWholeWord}
            aria-label="Whole word"
            variant="outline"
          >
            <span className="mr-1.5 text-xs font-bold">W</span>
            Whole Word
          </Toggle>
        </div>

        {findTerm && (
          <div className="flex h-14 items-center gap-3 border-b border-(--border)/60 px-5">
            <svg className="h-4 w-4 shrink-0 text-ink/30 dark:text-paper/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <input
              className="flex-1 bg-transparent border-none text-base font-serif italic text-ink placeholder:text-ink/30 focus:outline-hidden focus:ring-0 dark:text-paper dark:placeholder:text-paper/30"
              value={replaceTerm}
              onChange={(e) => setReplaceTerm(e.target.value)}
              placeholder="Replacement"
              aria-label="Replace with"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="rounded-lg disabled:opacity-40"
              onClick={onReplace}
              disabled={!canNavigate || !canReplace || matchIndex < 0}
              title="Replace current match"
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="rounded-lg disabled:opacity-40"
              onClick={onReplaceAll}
              disabled={!canNavigate || !canReplace}
              title="Replace all matches"
            >
              Replace all
            </Button>
          </div>
        )}

        {findTerm && (
          <div className="border-b border-(--border)/60 px-5 py-3">
            {open && canNavigate && matches.length > 0 && (
              <FindResults
                matches={matches}
                segments={segments}
                matchIndex={matchIndex}
                onMatchClick={(index) => { onMatchClick(index); handleClose({ preventScroll: true }) }}
              />
            )}
          </div>
        )}

        <div className="flex h-10 items-center justify-between border-t border-border bg-subtle px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canNavigate}
              aria-label="Previous match"
              title="Previous match"
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-30 ${flashUp
                ? 'border-ink/20 bg-ink/10 text-ink/80 dark:border-paper/20 dark:bg-paper/10 dark:text-paper/70'
                : 'border-ink/10 bg-ink/5 text-ink/60 hover:bg-ink/10 dark:border-paper/10 dark:bg-paper/5 dark:text-paper/50 dark:hover:bg-paper/10'
                }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!canNavigate}
              aria-label="Next match"
              title="Next match"
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-30 ${flashDown
                ? 'border-ink/20 bg-ink/10 text-ink/80 dark:border-paper/20 dark:bg-paper/10 dark:text-paper/70'
                : 'border-ink/10 bg-ink/5 text-ink/60 hover:bg-ink/10 dark:border-paper/10 dark:bg-paper/5 dark:text-paper/50 dark:hover:bg-paper/10'
                }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <span
              data-testid="match-summary"
              className="ml-1 text-[11px] font-mono text-ink/50 dark:text-paper/40"
            >
              {matchSummary}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              title="Clear search"
              className="text-[11px] font-mono text-ink/40 transition-colors hover:text-ink dark:text-paper/40 dark:hover:text-paper"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleClose()}
              aria-label="Close find/replace (Esc)"
              title="Close (Esc)"
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono transition-colors ${flashEsc
                ? 'border-ink/20 bg-ink/10 text-ink/60 dark:border-paper/20 dark:bg-paper/10 dark:text-paper/50'
                : 'border-ink/10 bg-ink/5 text-ink/40 hover:bg-ink/10 dark:border-paper/10 dark:bg-paper/5 dark:text-paper/30 dark:hover:bg-paper/10'
                }`}
            >
              ESC
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
