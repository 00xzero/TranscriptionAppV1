"use client"
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase, getAuthHeaders } from '../../lib/api'

type PresignedUpload = {
  project: {
    id: string
    status: string
    source_object_key: string
    created_at: string
    updated_at: string
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

  useEffect(() => { setApi(getApiBase()) }, [])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setResult(null)
    setStatus(f ? `Selected: ${f.name} (${f.type || 'application/octet-stream'})` : 'Idle')
  }, [])

  const onUpload = useCallback(async () => {
    if (!file) return
    if (uploadLockRef.current) return
    uploadLockRef.current = true
    setUploading(true)
    setStatus('Creating project...')
    try {
      const createRes = await fetch(`${api}/projects`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: file.name, filename: file.name, content_type: file.type || 'application/octet-stream' }),
      })
      if (!createRes.ok) throw new Error(`Create project failed: ${createRes.status}`)
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
    } catch (e: any) {
      console.error(e)
      setStatus(`Error: ${e.message || e}`)
    } finally {
      setUploading(false)
      uploadLockRef.current = false
    }
  }, [api, file, router])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Upload</h1>
      <p className="text-sm text-muted">API base: {api}</p>

      <div className="bg-surface border border-base rounded p-4 space-y-3">
        <input type="file" onChange={onFileChange} accept="audio/*,video/*" disabled={uploading} />
        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={!file || uploading}
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
          </div>
        )}
      </div>
    </div>
  )
}
