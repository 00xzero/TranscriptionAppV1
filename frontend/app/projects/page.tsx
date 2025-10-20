"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getApiBase } from '../../lib/api'

type Project = {
  id: string
  title?: string
  status: string
  source_object_key: string
  created_at: string
  updated_at: string
}

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const api = getApiBase()

  useEffect(() => {
    let timer: any
    const load = async () => {
      try {
        const res = await fetch(`${api}/projects`)
        const data = await res.json()
        setItems(data)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
    timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [api])

  const startProject = async (id: string) => {
    try {
      const res = await fetch(`${api}/projects/${id}/start`, { method: 'POST' })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Start failed (${res.status}): ${t}`)
      }
      // Refresh list after starting
      const list = await fetch(`${api}/projects`).then(r => r.json())
      setItems(list)
    } catch (e) {
      console.error(e)
      alert(String(e))
    }
  }

  const deleteProject = async (id: string) => {
    const ok = window.confirm(
      'Disclaimer: Deleting a project will permanently remove the project and all associated data (segments, speakers, and jobs). This action cannot be undone. Do you want to proceed?'
    )
    if (!ok) return
    try {
      const res = await fetch(`${api}/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Delete failed (${res.status}): ${t}`)
      }
      // Optimistically update list
      setItems(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      console.error(e)
      alert(String(e))
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Projects</h1>
      {loading && <div className="text-muted">Loading...</div>}
      {!loading && items.length === 0 && <div className="text-muted">No projects yet.</div>}
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id} className="bg-surface border border-base rounded p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{p.title || p.id}</div>
              <div className="text-xs text-muted">{p.status} • {new Date(p.created_at).toLocaleString()}</div>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50"
                onClick={() => startProject(p.id)}
                disabled={!['created', 'queued', 'error'].includes(p.status)}
                title="Start transcription"
              >Start</button>
              <Link href={`/editor/${p.id}`} className="accent hover:underline">Open</Link>
              <button
                className="p-2 rounded bg-red-600 text-white hover:bg-red-700"
                onClick={() => deleteProject(p.id)}
                title="Delete project"
                aria-label="Delete project"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M9 3.75A2.25 2.25 0 0 1 11.25 1.5h1.5A2.25 2.25 0 0 1 15 3.75V4.5h3.75a.75.75 0 0 1 0 1.5h-.6l-1.095 13.14A3 3 0 0 1 14.07 22.5H9.93a3 3 0 0 1-2.985-3.36L5.85 6H5.25a.75.75 0 0 1 0-1.5H9V3.75Zm1.5.75h3V3.75a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V4.5Zm-2.91 1.5h8.82l-1.08 12.96a1.5 1.5 0 0 1-1.485 1.29H9.93a1.5 1.5 0 0 1-1.485-1.29L7.59 6Z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
