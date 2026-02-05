"use client"

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface ModalContextType {
    isCaptureModalOpen: boolean
    openCaptureModal: () => void
    closeCaptureModal: () => void
}

const ModalContext = createContext<ModalContextType | undefined>(undefined)

export function ModalProvider({ children }: { children: ReactNode }) {
    const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)

    const openCaptureModal = useCallback(() => {
        setIsCaptureModalOpen(true)
    }, [])

    const closeCaptureModal = useCallback(() => {
        setIsCaptureModalOpen(false)
    }, [])

    return (
        <ModalContext.Provider value={{ isCaptureModalOpen, openCaptureModal, closeCaptureModal }}>
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
