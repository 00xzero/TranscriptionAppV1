'use client'

import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react'
import type { PeopleDirectory } from '@/contracts/db'
import { usePeopleDirectory, type ReloadingQuery } from './usePeopleData'

type PeopleDirectoryContextValue = {
  directory: ReloadingQuery<PeopleDirectory>
  /**
   * Set when a list row opens a person, so closing the dialog can go back to
   * that list entry instead of adding another.
   */
  openedFromListRef: RefObject<boolean>
}

const PeopleDirectoryContext = createContext<PeopleDirectoryContextValue | null>(null)

/**
 * One directory load for everything under /people: the list and the person
 * dialog over it read and reload the same data.
 */
export function PeopleDirectoryProvider({ children }: { children: ReactNode }) {
  const directory = usePeopleDirectory()
  const openedFromListRef = useRef(false)
  return (
    <PeopleDirectoryContext.Provider value={{ directory, openedFromListRef }}>
      {children}
    </PeopleDirectoryContext.Provider>
  )
}

export function usePeopleDirectoryContext(): PeopleDirectoryContextValue {
  const value = useContext(PeopleDirectoryContext)
  if (!value) throw new Error('usePeopleDirectoryContext must be used inside PeopleDirectoryProvider')
  return value
}
