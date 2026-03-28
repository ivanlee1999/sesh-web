'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Check, ChevronDown, X } from 'lucide-react'
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
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleClose = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setClosingId(taskId)
    setCompletedId(taskId)
    try {
      const res = await fetch(`/api/todoist/tasks/${taskId}/close`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to close task')
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

  const selectedTask = tasks.find(t => t.id === selectedTaskId)

  if (configured === null || configured === false) return null

  return (
    <div style={{ width: '100%' }} ref={dropdownRef}>
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

      {/* Dropdown trigger */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderRadius: 12,
          border: '1.5px solid',
          borderColor: selectedTask ? 'var(--accent)' : 'var(--border)',
          background: selectedTask ? 'var(--accent-light)' : 'var(--bg-secondary)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
      >
        <span style={{
          fontSize: 15,
          color: selectedTask ? 'var(--text-primary)' : 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          textAlign: 'left',
        }}>
          {selectedTask ? selectedTask.content : tasks.length === 0 ? 'No tasks for today' : 'Select a task...'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {selectedTask && (
            <motion.div
              whileTap={{ scale: 0.85 }}
              onClick={(e) => { e.stopPropagation(); onSelectTask(null) }}
              style={{
                padding: 2,
                borderRadius: 6,
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
              }}
            >
              <X className="w-4 h-4" />
            </motion.div>
          )}
          <ChevronDown
            className="w-4 h-4"
            style={{
              color: 'var(--text-tertiary)',
              transition: 'transform 0.2s ease',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </div>
      </motion.button>

      {/* Dropdown menu */}
      <AnimatePresence>
        {isOpen && tasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -8, scaleY: 0.95 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            style={{
              marginTop: 6,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              boxShadow: 'var(--shadow-md)',
              overflow: 'hidden',
              transformOrigin: 'top center',
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {tasks.map((task, i) => {
              const isSelected = selectedTaskId === task.id
              const isCompleted = completedId === task.id
              const isClosing = closingId === task.id

              return (
                <motion.button
                  key={task.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    onSelectTask(isSelected ? null : task)
                    setIsOpen(false)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: i < tasks.length - 1 ? '1px solid var(--border)' : 'none',
                    background: isSelected ? 'var(--accent-light)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                    textAlign: 'left',
                  }}
                >
                  {/* Checkbox */}
                  <div style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: `2px solid ${isCompleted ? 'var(--success)' : isSelected ? 'var(--accent)' : 'var(--text-tertiary)'}`,
                    background: isCompleted ? 'var(--success)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    flexShrink: 0,
                  }}>
                    {isSelected && !isCompleted && (
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                      }} />
                    )}
                    {isCompleted && (
                      <Check style={{ width: 12, height: 12, color: '#fff' }} strokeWidth={3} />
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 15,
                      color: 'var(--text-primary)',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: isCompleted ? 'line-through' : 'none',
                      opacity: isCompleted ? 0.5 : 1,
                    }}>
                      {task.content}
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      {task.duration && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {task.duration.amount}min
                        </span>
                      )}
                      {task.priority > 1 && (
                        <span style={{
                          fontSize: 12,
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
                    style={{
                      padding: 4,
                      borderRadius: 6,
                      color: 'var(--text-tertiary)',
                      cursor: 'pointer',
                      opacity: isClosing ? 0.5 : 1,
                      pointerEvents: isClosing ? 'none' : 'auto',
                      flexShrink: 0,
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
