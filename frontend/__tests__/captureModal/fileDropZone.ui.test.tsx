import React, { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileDropZone from '@/components/CaptureModal/FileDropZone'
import { TooltipProvider } from '@/components/ui/tooltip'

const sampleFile = () => new File(['audio'], 'kickoff.m4a', { type: 'audio/mp4' })

function Harness({
  initialFile = sampleFile(),
  isUploading = false,
  onClearFile = jest.fn(),
  onFileSelect = jest.fn(),
}: {
  initialFile?: File | null
  isUploading?: boolean
  onClearFile?: () => void
  onFileSelect?: (file: File) => void
}) {
  const [file, setFile] = useState<File | null>(initialFile)
  return (
    <TooltipProvider delayDuration={0}>
      <FileDropZone
        selectedFile={file}
        onFileSelect={onFileSelect}
        onClearFile={() => {
          onClearFile()
          setFile(null)
        }}
        isUploading={isUploading}
        displayError={null}
        maxFileSizeLabel="2 GB"
      />
    </TooltipProvider>
  )
}

describe('FileDropZone remove button', () => {
  test('is absent until a file is selected', () => {
    render(<Harness initialFile={null} />)
    expect(screen.queryByRole('button', { name: /^remove/i })).not.toBeInTheDocument()
  })

  test('is absent while uploading', () => {
    render(<Harness isUploading />)
    expect(screen.queryByRole('button', { name: /^remove/i })).not.toBeInTheDocument()
  })

  test('clears the file and returns focus to the empty drop zone', async () => {
    const user = userEvent.setup()
    const onClearFile = jest.fn()
    const onFileSelect = jest.fn()
    const openPicker = jest.spyOn(HTMLInputElement.prototype, 'click')
    render(<Harness onClearFile={onClearFile} onFileSelect={onFileSelect} />)

    await user.click(screen.getByRole('button', { name: 'Remove kickoff.m4a' }))

    expect(onClearFile).toHaveBeenCalledTimes(1)
    expect(onFileSelect).not.toHaveBeenCalled()
    expect(openPicker).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^remove/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose an audio or video file' })).toHaveFocus()
    openPicker.mockRestore()
  })

  test('is not nested inside the drop zone button', () => {
    render(<Harness />)
    const dropZone = screen.getByRole('button', { name: /change selected file/i })
    expect(dropZone).not.toContainElement(screen.getByRole('button', { name: 'Remove kickoff.m4a' }))
  })
})
