import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import ExportModal from '../components/ExportModal'

const makeExportResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name: string) => name.toLowerCase() === 'content-disposition'
      ? 'attachment; filename="custom-export.vtt"'
      : null,
  },
  blob: async () => new Blob(['export-content'], { type: 'text/plain' }),
})

describe('ExportModal - Phase 7 UI regressions', () => {
  const originalCreateObjectURL = window.URL.createObjectURL
  const originalRevokeObjectURL = window.URL.revokeObjectURL
  let clickSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    ;(window.URL.createObjectURL as unknown as jest.Mock) = jest.fn(() => 'blob:mock-download')
    ;(window.URL.revokeObjectURL as unknown as jest.Mock) = jest.fn()
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })
  })

  afterEach(() => {
    document.body.style.overflow = ''
    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
    clickSpy.mockRestore()
    jest.useRealTimers()
  })

  test('exports using selected format endpoint and closes after success', async () => {
    const user = userEventLib.setup()
    const onClose = jest.fn()
    const fetchMock = jest.fn().mockResolvedValue(makeExportResponse())
    // @ts-ignore
    global.fetch = fetchMock

    render(<ExportModal projectId="p1" projectTitle="Phase7 Project" onClose={onClose} />)

    await user.click(screen.getByText(/^VTT$/i))
    await user.click(screen.getByRole('button', { name: /^Export$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1/export/vtt')
    })
    await waitFor(() => {
      expect(screen.getByText(/Download started successfully/i)).toBeInTheDocument()
    })
  })

  test('traps focus, locks scroll, and closes on Escape', async () => {
    const user = userEventLib.setup()
    const onClose = jest.fn()
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue(makeExportResponse())

    const { unmount } = render(
      <ExportModal projectId="p1" projectTitle="Phase7 Project" onClose={onClose} />
    )

    expect(document.body.style.overflow).toBe('hidden')

    const docxRadio = screen.getByRole('radio', { name: /Word \(\.docx\)/i })
    const cancelButton = screen.getByRole('button', { name: /Cancel/i })
    const exportButton = screen.getByRole('button', { name: /^Export$/i })

    expect(docxRadio).toHaveFocus()
    await user.tab()
    expect(cancelButton).toHaveFocus()
    await user.tab()
    expect(exportButton).toHaveFocus()
    await user.tab()
    expect(docxRadio).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
