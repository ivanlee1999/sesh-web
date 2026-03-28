'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Check, RefreshCw, Trash2 } from 'lucide-react'
import type { Session, SessionType } from '@/types'

function formatRelativeDate(ts: number): string {
  const now = new Date()
  const date = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))

  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'YESTERDAY'
  return date.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
}

interface LogGroup {
  label: string
  items: Array<{
    key: string
    title: string
    totalMinutes: number
    sessionCount: number
    type: SessionType
    ids: string[]
  }>
}

function aggregateSessions(sessions: Session[]): LogGroup[] {
  const dateGroups = new Map<string, Session[]>()

  for (const s of sessions) {
    const label = formatRelativeDate(s.startedAt)
    if (!dateGroups.has(label)) dateGroups.set(label, [])
    dateGroups.get(label)!.push(s)
  }

  const result: LogGroup[] = []

  for (const [label, daySessions] of Array.from(dateGroups.entries())) {
    const aggregated = new Map<string, LogGroup['items'][0]>()

    for (const s of daySessions) {
      const normalizedIntention = (s.intention || '').trim().toLowerCase()
      const key = `${s.type}::${normalizedIntention}`
      const title = s.intention?.trim() || (s.type === 'focus' ? 'Focus session' : s.type === 'short-break' ? 'Short break' : 'Long break')

      if (aggregated.has(key)) {
        const existing = aggregated.get(key)!
        existing.totalMinutes += Math.round(s.actualMs / 60000)
        existing.sessionCount += 1
        existing.ids.push(s.id)
      } else {
        aggregated.set(key, {
          key: s.id,
          title,
          totalMinutes: Math.round(s.actualMs / 60000),
          sessionCount: 1,
          type: s.type,
          ids: [s.id],
        })
      }
    }

    result.push({ label, items: Array.from(aggregated.values()) })
  }

  return result
}

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
}

export default function SessionLog() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setSessions(data)
    } catch {
      setError('Failed to load session history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (ids: string[]) => {
    setDeletingIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.add(id))
      return next
    })
    try {
      for (const id of ids) {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed to delete')
      }
      await load()
    } catch {
      setError('Failed to delete session.')
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    }
  }

  const groups = aggregateSessions(sessions)

  return (
    <div style={{ padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>Sessions</h1>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={load}
          disabled={loading}
          style={{
            padding: 8,
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          borderRadius: 12,
          background: 'rgba(255, 59, 48, 0.08)',
          color: 'var(--danger)',
          fontSize: 14,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {loading && groups.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: 14 }}>Loading...</p>
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: 17, fontWeight: 500 }}>No sessions yet</p>
          <p style={{ fontSize: 14, marginTop: 4, color: 'var(--text-tertiary)' }}>
            Complete a session to see your log
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {groups.map((group) => (
          <div key={group.label}>
            <p className="section-label">{group.label}</p>
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ staggerChildren: 0.04 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              {group.items.map((item) => {
                const isBreak = item.type !== 'focus'
                const isDeleting = item.ids.some(id => deletingIds.has(id))
                return (
                  <motion.div
                    key={item.key}
                    variants={itemVariants}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    className="log-entry"
                  >
                    <div className={`log-check ${isBreak ? 'log-check--break' : ''}`}>
                      <Check style={{ width: 12, height: 12 }} strokeWidth={3} />
                    </div>
                    <span className="log-entry__title">
                      {item.title}
                    </span>
                    <span className="log-entry__detail">
                      {item.totalMinutes} min {item.type}
                      {item.sessionCount > 1 ? ` (${item.sessionCount})` : ''}
                    </span>
                    <button
                      onClick={() => handleDelete(item.ids)}
                      disabled={isDeleting}
                      style={{
                        padding: 6,
                        borderRadius: 8,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-tertiary)',
                        cursor: 'pointer',
                        flexShrink: 0,
                        opacity: isDeleting ? 0.5 : 1,
                      }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  )
}
