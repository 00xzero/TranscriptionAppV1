"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useModal } from '@/lib/ModalContext'

/**
 * /upload redirect page
 * 
 * This page is kept for backwards compatibility with existing links.
 * It redirects to the Library view and opens the Capture modal.
 */
export default function UploadPage() {
  const router = useRouter()
  const { openCaptureModal } = useModal()

  useEffect(() => {
    // Open the Capture modal and redirect to Library
    openCaptureModal()
    router.replace('/')
  }, [openCaptureModal, router])

  // Show minimal loading state during redirect
  return (
    <div className="flex items-center justify-center h-[50vh] pt-[56px]">
      <div className="text-center text-ink/50 dark:text-paper/50">
        <p className="text-sm">Redirecting...</p>
      </div>
    </div>
  )
}
