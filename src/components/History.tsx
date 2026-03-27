'use client'
import { useState, useEffect, useCallback } from 'react'
import type { Session } from '@/types'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/types'
import { Trash2 } from 'lucide-react'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

function msToMin(ms: number): string {
  return `${Math.round(ms / 60000)}m`
}

function groupByDate(sessions: Session[]): { date: string; sessions: Session[] }[] {
  const groups = new Map<string, Session[]>()
  for (const s of sessions) {
    const key = formatDate(s.startedAt)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }
  return Array.from(groups.entries()).map(([date, sessions]) => ({ date, sessions }))
}

export default function History() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) {
        throw new Error('Failed to load sessions')
      }
      const data = await res.json()
      setSessions(data)
    } catch {
      setError('Failed to load session history. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    setError(null)
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('Failed to delete session')
      }
      await load()
    } catch {
      setError('Failed to delete session. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  const groups = groupByDate(sessions)

  return (
    <div className="px-4 pt-16 md:pt-20 pb-4">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">History</h1>
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 mb-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {loading && groups.length === 0 && !error && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">Loading…</p>
        </div>
      )}
      {!loading && !error && groups.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No sessions yet</p>
          <p className="text-sm mt-1">Complete a session to see your history</p>
        </div>
      )}
      <div className="flex flex-col gap-6">
        {groups.map(({ date, sessions }) => (
          <div key={date}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{date}</h2>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sessions.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className="w-1.5 h-10 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CATEGORY_COLORS[s.category] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {s.intention || <span className="text-gray-400 italic capitalize">{s.type}</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{formatTime(s.startedAt)}</span>
                      <span className="text-xs text-gray-300">&middot;</span>
                      <span className="text-xs text-gray-500">{CATEGORY_LABELS[s.category]}</span>
                      <span className="text-xs text-gray-300">&middot;</span>
                      <span className="text-xs text-gray-500 capitalize">{s.type}</span>
                    </div>
                  </div>
                  <span className="font-mono text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
                    {msToMin(s.actualMs)}
                  </span>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
