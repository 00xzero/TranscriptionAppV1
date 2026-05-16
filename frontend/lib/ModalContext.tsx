"use client"

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface ModalContextType {
  isCaptureModalOpen: boolean
  captureModalIntent: CaptureModalIntent | null
  openCaptureModal: (intent?: CaptureModalIntent) => void
  closeCaptureModal: () => void
}

export interface CaptureModalIntent {
  initialTab?: 'upload' | 'record'
  message?: string
}

const ModalContext = createContext<ModalContextType | undefined>(undefined)

export function ModalProvider({ children }: { children: ReactNode }) {
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)
  const [captureModalIntent, setCaptureModalIntent] =
    useState<CaptureModalIntent | null>(null)

  const openCaptureModal = useCallback((intent?: CaptureModalIntent) => {
    setCaptureModalIntent(intent ?? null)
    setIsCaptureModalOpen(true)
  }, [])

  const closeCaptureModal = useCallback(() => {
    setIsCaptureModalOpen(false)
    setCaptureModalIntent(null)
  }, [])

  return (
    <ModalContext.Provider value={{ isCaptureModalOpen, captureModalIntent, openCaptureModal, closeCaptureModal }}>
      {children}
    </ModalContext.Provider>
  )
}

export function useModal() {
  const context = useContext(ModalContext)
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider')
  }
  return context
}
