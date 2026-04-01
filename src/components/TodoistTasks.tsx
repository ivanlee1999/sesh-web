'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from 'konsta/react'
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
  const [open, setOpen] = useState(false)

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

  const triggerText = selectedTask
    ? selectedTask.content
    : tasks.length === 0
    ? 'No tasks for today'
    : 'Select a task...'

  return (
    <div className="w-full">
      {error && (
        <p className="mb-2 text-xs text-red-500 dark:text-red-400">{error}</p>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left text-sm ${
          selectedTask
            ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950'
            : 'border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800'
        } text-black dark:text-white`}
      >
        <span className="truncate">{triggerText}</span>
        <span className="ml-2 flex items-center gap-1">
          <span
            className="cursor-pointer p-1 text-gray-400"
            onClick={(e) => { e.stopPropagation(); fetchTasks() }}
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </span>
      </button>

      {selectedTask && (
        <div className="mt-1 flex justify-center">
          <button
            onClick={() => onSelectTask(null)}
            className="border-none bg-transparent text-xs text-gray-500 underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Inline collapsible dropdown */}
      {open && (
        <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#2c2c2e]">
          {tasks.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-gray-400">
              No tasks for today
            </div>
          )}
          {tasks.map((task) => {
            const isSelected = selectedTaskId === task.id
            const isCompleted = completedId === task.id
            const isClosing = closingId === task.id

            return (
              <div
                key={task.id}
                onClick={() => {
                  onSelectTask(isSelected ? null : task)
                  setOpen(false)
                }}
                className={`flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 dark:border-gray-700 ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {/* Checkbox */}
                <div
                  className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-2"
                  style={{
                    borderColor: isCompleted ? '#34C759' : isSelected ? '#007aff' : '#9CA3AF',
                    background: isCompleted ? '#34C759' : 'transparent',
                  }}
                >
                  {isSelected && !isCompleted && (
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                  )}
                  {isCompleted && (
                    <Check style={{ width: 12, height: 12, color: '#fff' }} strokeWidth={3} />
                  )}
                </div>

                {/* Task content */}
                <div className="flex-1 min-w-0">
                  <span className={`block truncate text-sm text-black dark:text-white ${isCompleted ? 'line-through opacity-50' : ''}`}>
                    {task.content}
                  </span>
                  {task.duration && (
                    <span className="text-xs text-gray-400">{task.duration.amount}min</span>
                  )}
                </div>

                {/* Priority + close button */}
                <div className="flex flex-shrink-0 items-center gap-2">
                  {task.priority > 1 && (
                    <Badge
                      className={
                        task.priority === 4
                          ? '!bg-red-500 !text-white'
                          : task.priority === 3
                          ? '!bg-orange-500 !text-white'
                          : '!bg-blue-500 !text-white'
                      }
                    >
                      P{5 - task.priority}
                    </Badge>
                  )}
                  <button
                    className="rounded-md p-1 text-gray-400 hover:text-green-500"
                    onClick={(e) => handleClose(task.id, e)}
                    style={{
                      opacity: isClosing ? 0.5 : 1,
                      pointerEvents: isClosing ? 'none' : 'auto',
                    }}
                  >
                    {isClosing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
