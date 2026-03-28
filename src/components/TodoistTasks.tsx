'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TodoistTask } from '@/types'

interface Props {
  selectedTaskId: string | null
  onSelectTask: (task: TodoistTask | null) => void
}

export default function TodoistTasks({ selectedTaskId, onSelectTask }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<TodoistTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [completedId, setCompletedId] = useState<string | null>(null)

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/todoist/status')
      if (!res.ok) { setConfigured(false); return }
      const data = await res.json()
      setConfigured(data.configured)
    } catch {
      setConfigured(false)
    }
  }, [])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/todoist/tasks')
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])
  useEffect(() => { if (configured) fetchTasks() }, [configured, fetchTasks])

  const handleClose = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setClosingId(taskId)
    setCompletedId(taskId)
    try {
      const res = await fetch(`/api/todoist/tasks/${taskId}/close`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to close task')
      // Brief delay to show completion animation
      setTimeout(() => {
        setTasks(prev => prev.filter(t => t.id !== taskId))
        if (selectedTaskId === taskId) onSelectTask(null)
        setCompletedId(null)
      }, 400)
    } catch {
      setCompletedId(null)
    } finally {
      setClosingId(null)
    }
  }, [selectedTaskId, onSelectTask])

  if (configured === null || configured === false) return null

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="section-label" style={{ marginBottom: 0 }}>TODAY&apos;S TASKS</p>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={fetchTasks}
          disabled={loading}
          style={{
            padding: 6,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 8 }}>{error}</p>
      )}

      {!loading && tasks.length === 0 && !error && (
        <p style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>No tasks for today</p>
      )}

      <AnimatePresence>
        {tasks.map(task => {
          const isSelected = selectedTaskId === task.id
          const isCompleted = completedId === task.id
          const isClosing = closingId === task.id

          let checkboxClass = 'things-checkbox'
          if (isCompleted) checkboxClass += ' things-checkbox--completed'
          else if (isSelected) checkboxClass += ' things-checkbox--selected'

          return (
            <motion.button
              key={task.id}
              layout
              whileTap={{ scale: 0.97 }}
              exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
              onClick={() => onSelectTask(isSelected ? null : task)}
              className="task-row"
            >
              {/* Checkbox */}
              <motion.div
                className={checkboxClass}
                animate={isCompleted ? { scale: [1, 1.2, 1] } : {}}
                transition={{ duration: 0.3 }}
              >
                {isCompleted && (
                  <Check style={{ width: 12, height: 12, color: '#fff' }} strokeWidth={3} />
                )}
              </motion.div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  className="task-row__content"
                  style={isCompleted ? { textDecoration: 'line-through', opacity: 0.5 } : undefined}
                >
                  {task.content}
                </p>
                <div className="task-row__meta">
                  {task.duration && (
                    <span>{task.duration.amount}min</span>
                  )}
                  {task.priority > 1 && (
                    <span style={{
                      color: task.priority === 4 ? 'var(--danger)' : task.priority === 3 ? 'var(--warning)' : 'var(--accent)'
                    }}>
                      P{5 - task.priority}
                    </span>
                  )}
                </div>
              </div>

              {/* Complete button */}
              <motion.div
                whileTap={{ scale: 0.85 }}
                onClick={(e) => handleClose(task.id, e)}
                className="task-row__close-btn"
                style={{
                  opacity: isClosing ? 0.5 : 1,
                  pointerEvents: isClosing ? 'none' : 'auto',
                }}
              >
                {isClosing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
              </motion.div>
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
