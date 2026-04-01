import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import CaptureModal from '../components/CaptureModal'

const mockCloseCaptureModal = jest.fn()
const mockModalState = {
  isCaptureModalOpen: true,
}
const mockCaptureFormState = {
  isUploading: false,
}

jest.mock('../lib/ModalContext', () => ({
  useModal: () => ({
    isCaptureModalOpen: mockModalState.isCaptureModalOpen,
    closeCaptureModal: mockCloseCaptureModal,
  }),
}))

jest.mock('../components/CaptureModal/useCaptureForm', () => ({
  useCaptureForm: () => ({
    selectedFile: null,
    handleFileSelect: jest.fn(),
    title: '',
    setTitle: jest.fn(),
    keyTerms: [],
    keyTermInput: '',
    setKeyTermInput: jest.fn(),
    keyTermsError: null,
    handleKeyTermKeyDown: jest.fn(),
    handleAddTermClick: jest.fn(),
    removeTerm: jest.fn(),
    isUploading: mockCaptureFormState.isUploading,
    handleSubmit: jest.fn(),
    canSubmit: false,
    displayError: null,
    maxFileSizeLabel: '100 MB',
    buttonText: 'Begin Transcription',
  }),
}))

describe('CaptureModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockModalState.isCaptureModalOpen = true
    mockCaptureFormState.isUploading = false
  })

  test('renders as an accessible dialog and closes when idle', async () => {
    const user = userEventLib.setup()
    render(<CaptureModal />)

    expect(screen.getByRole('dialog', { name: /Capture/i })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()

    await user.click(overlay as Element)
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(2)
  })

  test('blocks dismissal while uploading', async () => {
    const user = userEventLib.setup()
    mockCaptureFormState.isUploading = true

    render(<CaptureModal />)

    fireEvent.keyDown(document, { key: 'Escape' })

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()

    await user.click(overlay as Element)

    expect(mockCloseCaptureModal).not.toHaveBeenCalled()
  })

  test('restores focus to the opener after closing', () => {
    jest.useFakeTimers()
    mockModalState.isCaptureModalOpen = false

    function Harness() {
      return (
        <>
          <button type="button">Open capture</button>
          <CaptureModal />
        </>
      )
    }

    const { rerender } = render(<Harness />)

    const openButton = screen.getByRole('button', { name: /open capture/i })
    openButton.focus()
    expect(openButton).toHaveFocus()

    mockModalState.isCaptureModalOpen = true
    rerender(<Harness />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockCloseCaptureModal).toHaveBeenCalledTimes(1)

    mockModalState.isCaptureModalOpen = false
    rerender(<Harness />)

    act(() => {
      jest.runOnlyPendingTimers()
    })

    expect(openButton).toHaveFocus()
    jest.useRealTimers()
  })
})
