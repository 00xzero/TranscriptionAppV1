"use client"
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { validateMediaFile, uploadProjectMedia, MAX_FILE_SIZE_DISPLAY } from '@/lib/supabase/storage'
import { KeyTermsInput, validateKeyTerms } from '../../components/KeyTermsInput'

type ProjectResponse = {
  project: {
    id: string
    status: string
    title: string
    created_at: string
    updated_at: string
    key_terms?: string[]
  }
  storagePath: string
}

export default function UploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string>('Idle')
  const [uploading, setUploading] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [result, setResult] = useState<ProjectResponse | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const uploadLockRef = useRef(false)

  // Key terms state
  const [keyTerms, setKeyTerms] = useState<string[]>([])
  const [keyTermsError, setKeyTermsError] = useState<string | null>(null)

  // User ID for upload path
  const [userId, setUserId] = useState<string | null>(null)

  // Get current user on mount
  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserId(user.id)
      }
    }
    getUser()
  }, [])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setResult(null)
    setFileError(null)
    setUploadProgress(0)

    if (f) {
      // Validate file immediately
      const validationError = validateMediaFile(f)
      if (validationError) {
        setFileError(validationError)
        setStatus('File validation failed')
      } else {
        const sizeMB = (f.size / (1024 * 1024)).toFixed(1)
        setStatus(`Selected: ${f.name} (${sizeMB}MB)`)
      }
    } else {
      setStatus('Idle')
    }
  }, [])

  // Validate key terms whenever they change
  const handleKeyTermsChange = useCallback((terms: string[]) => {
    setKeyTerms(terms)
    const error = validateKeyTerms(terms)
    setKeyTermsError(error)
  }, [])

  const onUpload = useCallback(async () => {
    if (!file || !userId) return
    if (uploadLockRef.current) return

    // Validate file
    const fileValidationError = validateMediaFile(file)
    if (fileValidationError) {
      setFileError(fileValidationError)
      return
    }

    // Validate key terms before upload
    const validationError = validateKeyTerms(keyTerms)
    if (validationError) {
      setKeyTermsError(validationError)
      return
    }

    uploadLockRef.current = true
    setUploading(true)
    setUploadProgress(0)
    setStatus('Creating project...')

    try {
      // Step 1: Create project via API
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: file.name,
          filename: file.name,
          key_terms: keyTerms.length > 0 ? keyTerms : undefined,
        }),
      })

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}))
        throw new Error(errorData.error || `Create project failed: ${createRes.status}`)
      }

      const projectData: ProjectResponse = await createRes.json()
      setResult(projectData)
      setStatus('Uploading to storage...')
      setUploadProgress(10)

      // Step 2: Upload file to Supabase Storage
      const supabase = createClient()
      const { path, error: uploadError } = await uploadProjectMedia(
        supabase,
        file,
        userId,
        projectData.project.id,
        (percent) => {
          // Map to 10-90% range for upload phase
          setUploadProgress(10 + Math.round(percent * 0.8))
        }
      )

      if (uploadError || !path) {
        throw new Error(uploadError || 'Upload failed')
      }

      setUploadProgress(95)
      setStatus('Finalizing...')

      // Step 3: Update project with storage path
      const { error: updateError } = await supabase
        .from('projects')
        .update({ source_object_key: path })
        .eq('id', projectData.project.id)

      if (updateError) {
        console.error('Failed to update project with storage path:', updateError)
        // Non-fatal for now, but log it
      }

      setUploadProgress(100)
      setStatus(`Upload complete. Project ID: ${projectData.project.id}`)

      // Redirect to projects page
      router.push('/projects')
    } catch (e: unknown) {
      console.error(e)
      const message = e instanceof Error ? e.message : String(e)
      setStatus(`Error: ${message}`)
      setUploadProgress(0)
    } finally {
      setUploading(false)
      uploadLockRef.current = false
    }
  }, [file, userId, keyTerms, router])

  // Disable upload if there's a validation error
  const isUploadDisabled = !file || !userId || uploading || !!keyTermsError || !!fileError

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Upload</h1>

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
          {fileError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{fileError}</p>
          )}
          <p className="mt-1 text-xs text-muted">
            Maximum file size: {MAX_FILE_SIZE_DISPLAY}. Supported formats: MP3, WAV, OGG, FLAC, MP4, WebM, MOV, AVI
          </p>
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

        {/* Progress bar */}
        {uploading && (
          <div className="space-y-1">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-muted">{uploadProgress}%</p>
          </div>
        )}

        <div className="text-sm text-muted">{status}</div>

        {result && (
          <div className="text-xs text-muted">
            <div>Storage path: {result.storagePath}</div>
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
