/** Start a browser-local download and keep the URL alive for the browser to read. */
export function downloadRecording(file: File): void {
  const url = URL.createObjectURL(file)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
