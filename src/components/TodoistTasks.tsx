'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Check, ExternalLink } from 'lucide-react'
import type { TodoistTask } from '@/types'

interface Props {
  selectedTaskId: string | null
  onSelectTask: (task: TodoistTask | null) => void
}

const PRIORITY_COLORS: Record<number, string> = {
  4: 'text-red-500',
  3: 'text-orange-500',
  2: 'text-blue-500',
  1: 'text-gray-400',
}

export default function TodoistTasks({ selectedTaskId, onSelectTask }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<TodoistTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)

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

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  useEffect(() => {
    if (configured) fetchTasks()
  }, [configured, fetchTasks])

  const handleClose = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setClosingId(taskId)
    try {
      const res = await fetch(`/api/todoist/tasks/${taskId}/close`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to close task')
      // Remove from list
      setTasks(prev => prev.filter(t => t.id !== taskId))
      if (selectedTaskId === taskId) onSelectTask(null)
    } catch {
      // Silently fail — user can retry
    } finally {
      setClosingId(null)
    }
  }, [selectedTaskId, onSelectTask])

  // Don't render if not configured or still checking
  if (configured === null || configured === false) return null

  return (
    <div className="w-full max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Todoist Tasks
        </h3>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
          title="Refresh tasks"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500 mb-2">{error}</p>
      )}

      {!loading && tasks.length === 0 && !error && (
        <p className="text-xs text-gray-400">No tasks for today</p>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {tasks.map(task => {
            const isSelected = selectedTaskId === task.id
            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(isSelected ? null : task)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-left ${
                  isSelected
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
                }`}
              >
                {/* Selection indicator */}
                <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  isSelected
                    ? 'border-green-500 bg-green-500'
                    : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isSelected && (
                    <Check className="w-full h-full text-white" strokeWidth={3} />
                  )}
                </div>

                {/* Task content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                    {task.content}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.duration && (
                      <span className="text-[10px] text-gray-400">
                        {task.duration.amount}min
                      </span>
                    )}
                    <span className={`text-[10px] ${PRIORITY_COLORS[task.priority] ?? 'text-gray-400'}`}>
                      {task.priority > 1 ? `P${5 - task.priority}` : ''}
                    </span>
                  </div>
                </div>

                {/* Complete in Todoist button */}
                <button
                  onClick={(e) => handleClose(task.id, e)}
                  disabled={closingId === task.id}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-green-500 transition-colors flex-shrink-0 disabled:opacity-50"
                  title="Complete in Todoist"
                >
                  {closingId === task.id ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
