"use client"
import { useEffect, useState } from 'react'
import { getApiBase } from '../../lib/api'

export default function HealthPage() {
  const [status, setStatus] = useState<string>('Loading...')

  useEffect(() => {
    const base = getApiBase()
    fetch(`${base}/health`).then(async (r) => {
      const j = await r.json()
      setStatus(JSON.stringify(j, null, 2))
    }).catch((e) => setStatus(`Failed: ${e}`))
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">API Health</h1>
      <pre className="p-4 bg-surface border border-base rounded overflow-auto text-sm">{status}</pre>
    </div>
  )
}
