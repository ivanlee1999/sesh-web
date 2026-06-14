'use client'
import { useState, useEffect, useCallback } from 'react'
import { List, ListItem, ListGroup } from 'konsta/react'
import type { Session } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { getCategoryMeta } from '@/lib/categories'
import { Pencil, Trash2, X } from 'lucide-react'

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
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [editIntention, setEditIntention] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editNotes, setEditNotes] = useState('')
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

  const openEdit = (session: Session) => {
    setError(null)
    setEditingSession(session)
    setEditIntention(session.intention ?? '')
    setEditCategory(session.category || categories[0]?.name || 'other')
    setEditNotes(session.notes ?? '')
  }

  const closeEdit = () => {
    if (savingId) return
    setEditingSession(null)
  }

  const handleSaveEdit = async () => {
    if (!editingSession) return
    setError(null)
    setSavingId(editingSession.id)
    try {
      const res = await fetch(`/api/sessions/${editingSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intention: editIntention,
          category: editCategory,
          notes: editNotes,
        }),
      })
      if (!res.ok) {
        throw new Error('Failed to update session')
      }
      const data = await res.json()
      if (data.session) {
        setSessions(prev => prev.map(s => s.id === data.session.id ? data.session : s))
      } else {
        await load()
      }
      setEditingSession(null)
    } catch {
      setError('Failed to update session. Please try again.')
    } finally {
      setSavingId(null)
    }
  }

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
    <div className="px-4 pb-6 pt-16 md:pt-20">
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
                      <div className="mt-1 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">{formatTime(s.startedAt)}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">{meta.label}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-500 dark:bg-gray-700 dark:text-gray-300">{(s.type as string) === 'short-break' || (s.type as string) === 'long-break' || s.type === 'break' ? 'rest' : s.type}</span>
                        </div>
                        {s.notes && <p className="line-clamp-2 text-xs text-gray-400 dark:text-gray-500">{s.notes}</p>}
                      </div>
                    }
                    after={
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1 font-mono text-xs font-semibold text-black dark:bg-gray-700 dark:text-white">
                          {msToMin(s.actualMs)}
                        </span>
                        <button
                          onClick={() => openEdit(s)}
                          className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20"
                          aria-label="Edit session"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={deletingId === s.id}
                          className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20"
                          aria-label="Delete session"
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

      {editingSession && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-black dark:text-white">Edit session</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Changes sync to Google Calendar when this session has a calendar event.
                </p>
              </div>
              <button
                onClick={closeEdit}
                className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="Close edit dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">Focus content</span>
              <input
                value={editIntention}
                onChange={e => setEditIntention(e.target.value)}
                placeholder="What did you focus on?"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-black outline-none transition-colors focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">Category</span>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-black outline-none transition-colors focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                {categories.map(category => (
                  <option key={category.id} value={category.name}>{category.label}</option>
                ))}
              </select>
            </label>

            <label className="mb-5 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-gray-500 dark:text-gray-400">Notes</span>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={4}
                placeholder="Optional notes"
                className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-black outline-none transition-colors focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>

            <div className="flex gap-3">
              <button
                onClick={closeEdit}
                disabled={!!savingId}
                className="flex-1 rounded-2xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingId === editingSession.id}
                className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingId === editingSession.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
