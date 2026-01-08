"use client"
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase, getAuthHeaders } from '../../lib/api'
import { KeyTermsInput, validateKeyTerms } from '../../components/KeyTermsInput'

type PresignedUpload = {
  project: {
    id: string
    status: string
    source_object_key: string
    created_at: string
    updated_at: string
    key_terms?: string[]
  }
  upload_url: string
  object_key: string
}

export default function UploadPage() {
  const router = useRouter()
  const [api, setApi] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string>('Idle')
  const [uploading, setUploading] = useState<boolean>(false)
  const [result, setResult] = useState<PresignedUpload | null>(null)
  const uploadLockRef = useRef(false)

  // Key terms state
  const [keyTerms, setKeyTerms] = useState<string[]>([])
  const [keyTermsError, setKeyTermsError] = useState<string | null>(null)

  useEffect(() => { setApi(getApiBase()) }, [])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setResult(null)
    setStatus(f ? `Selected: ${f.name} (${f.type || 'application/octet-stream'})` : 'Idle')
  }, [])

  // Validate key terms whenever they change
  const handleKeyTermsChange = useCallback((terms: string[]) => {
    setKeyTerms(terms)
    const error = validateKeyTerms(terms)
    setKeyTermsError(error)
  }, [])

  const onUpload = useCallback(async () => {
    if (!file) return
    if (uploadLockRef.current) return

    // Validate key terms before upload
    const validationError = validateKeyTerms(keyTerms)
    if (validationError) {
      setKeyTermsError(validationError)
      return
    }

    uploadLockRef.current = true
    setUploading(true)
    setStatus('Creating project...')
    try {
      const requestBody: Record<string, unknown> = {
        title: file.name,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
      }

      // Only include key_terms if non-empty
      if (keyTerms.length > 0) {
        requestBody.key_terms = keyTerms
      }

      const createRes = await fetch(`${api}/projects`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}))
        throw new Error(errorData.detail || `Create project failed: ${createRes.status}`)
      }
      const presigned: PresignedUpload = await createRes.json()
      setResult(presigned)
      setStatus('Uploading to object storage...')

      const putRes = await fetch(presigned.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      })
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`)
      setStatus(`Upload complete. Project ID: ${presigned.project.id}`)
      router.push('/projects')
    } catch (e: unknown) {
      console.error(e)
      const message = e instanceof Error ? e.message : String(e)
      setStatus(`Error: ${message}`)
    } finally {
      setUploading(false)
      uploadLockRef.current = false
    }
  }, [api, file, keyTerms, router])

  // Disable upload if there's a key terms validation error
  const isUploadDisabled = !file || uploading || !!keyTermsError

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Upload</h1>
      <p className="text-sm text-muted">API base: {api}</p>

      <div className="bg-surface border border-base rounded p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Audio/Video file
          </label>
          <input
            type="file"
            onChange={onFileChange}
            accept="audio/*,video/*"
            disabled={uploading}
          />
        </div>

        {/* Key Terms Input */}
        <KeyTermsInput
          value={keyTerms}
          onChange={handleKeyTermsChange}
          disabled={uploading}
          error={keyTermsError}
        />

        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isUploadDisabled}
            onClick={onUpload}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
        <div className="text-sm text-muted">{status}</div>
        {result && (
          <div className="text-xs text-muted">
            <div>Object key: {result.object_key}</div>
            <div>Project ID: {result.project.id}</div>
            {result.project.key_terms && result.project.key_terms.length > 0 && (
              <div>Key terms: {result.project.key_terms.join(', ')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
