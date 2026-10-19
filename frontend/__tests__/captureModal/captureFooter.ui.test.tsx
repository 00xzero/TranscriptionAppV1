import { render, screen } from '@testing-library/react'
import CaptureFooter from '@/components/CaptureModal/CaptureFooter'
import { formatUploadedBytes } from '@/lib/utils'

const MB = 1024 * 1024

function renderFooter(uploadBytes?: { sent: number; total: number } | null) {
  return render(
    <CaptureFooter
      isUploading={Boolean(uploadBytes)}
      canSubmit
      onClose={jest.fn()}
      onSubmit={jest.fn()}
      buttonText="Uploading file..."
      uploadBytes={uploadBytes}
    />
  )
}

describe('CaptureFooter upload progress', () => {
  test('shows no bar and the usual hint when nothing is uploading', () => {
    renderFooter(null)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('60-min file ≈ 5 min process')).toBeInTheDocument()
  })

  test('shows the bar and how much is in while a file uploads', () => {
    renderFooter({ sent: 48 * MB, total: 182 * MB })

    const bar = screen.getByRole('progressbar', { name: 'Upload progress' })
    expect(bar).toHaveAttribute('aria-valuenow', String(48 * MB))
    expect(bar).toHaveAttribute('aria-valuemax', String(182 * MB))
    expect(bar).toHaveAttribute('aria-valuetext', '48 of 182 MB uploaded')
    expect(screen.getByText('48 of 182 MB')).toBeInTheDocument()
    expect(screen.queryByText('60-min file ≈ 5 min process')).not.toBeInTheDocument()
  })
})

describe('formatUploadedBytes', () => {
  test('gives the part sent in the whole file\'s unit, rounded down', () => {
    expect(formatUploadedBytes(0, 182 * MB)).toBe('0 of 182 MB')
    expect(formatUploadedBytes(47.9 * MB, 182 * MB)).toBe('47 of 182 MB')
    expect(formatUploadedBytes(182 * MB, 182 * MB)).toBe('182 of 182 MB')
    expect(formatUploadedBytes(300 * 1024, 600 * 1024)).toBe('300 of 600 KB')
    expect(formatUploadedBytes(1.25 * 1024 * MB, 1.3 * 1024 * MB)).toBe('1.2 of 1.3 GB')
  })

  test('says the whole size once it is all in, even when the total was rounded up', () => {
    expect(formatUploadedBytes(181.6 * MB - 1, 181.6 * MB)).toBe('181 of 182 MB')
    expect(formatUploadedBytes(181.6 * MB, 181.6 * MB)).toBe('182 of 182 MB')
  })
})
