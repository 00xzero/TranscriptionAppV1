"use client"
import React, { useEffect, useState } from 'react'

const THEMES = ["light", "dark"] as const
export type AppTheme = typeof THEMES[number]

function applyTheme(theme: AppTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  try { localStorage.setItem('app-theme', theme) } catch { }
}

function detectInitialTheme(): AppTheme {
  try {
    const saved = localStorage.getItem('app-theme') as AppTheme | null
    if (saved && (THEMES as readonly string[]).includes(saved)) return saved
    if (saved === 'blue') return 'dark'  // backward compat: map removed "blue" theme to "dark"
  } catch { }
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<AppTheme>('light')

  useEffect(() => {
    const initial = detectInitialTheme()
    setTheme(initial)
    applyTheme(initial)
  }, [])

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="theme" className="sr-only">Theme</label>
      <select
        id="theme"
        value={theme}
        onChange={(e) => { const t = e.target.value as AppTheme; setTheme(t); applyTheme(t) }}
        className="border rounded px-2 py-1 bg-surface border-base"
        title="Theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  )
}
