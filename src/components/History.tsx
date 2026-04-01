'use client'
import { useState, useEffect, useCallback } from 'react'
import { List, ListItem, ListGroup } from 'konsta/react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
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
  const { categories } = useCategories()

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
    <div className="h-[calc(100dvh-83px-env(safe-area-inset-bottom,0px))] overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4 pt-16 [-webkit-overflow-scrolling:touch] md:pt-20">
      <h1 className="mb-4 text-xl font-semibold text-black dark:text-white">History</h1>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}
      {loading && groups.length === 0 && !error && (
        <div className="py-16 text-center text-gray-400">
          <p className="text-sm">Loading…</p>
        </div>
      )}
      {!loading && !error && groups.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          <p className="text-lg">No sessions yet</p>
          <p className="mt-1 text-sm">Start your first focus session!</p>
        </div>
      )}
      <div className="flex flex-col gap-6">
        {groups.map(({ date, sessions }) => (
          <ListGroup key={date}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">{date}</div>
            <List strong inset className="!my-0 !rounded-2xl">
              {sessions.map(s => {
                const meta = getCategoryMeta(s.category, categories)
                return (
                  <ListItem
                    key={s.id}
                    title={
                      <span className="truncate text-sm font-medium text-black dark:text-white">
                        {s.intention || <span className="capitalize italic text-gray-400">{s.type}</span>}
                      </span>
                    }
                    subtitle={
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">{formatTime(s.startedAt)}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">{meta.label}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-500 dark:bg-gray-700 dark:text-gray-300">{s.type}</span>
                      </div>
                    }
                    after={
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1 font-mono text-xs font-semibold text-black dark:bg-gray-700 dark:text-white">
                          {msToMin(s.actualMs)}
                        </span>
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={deletingId === s.id}
                          className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    }
                    media={
                      <div
                        className="h-10 w-1.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                    }
                  />
                )
              })}
            </List>
          </ListGroup>
        ))}
      </div>
    </div>
  )
}
