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
    <div className="relative w-full" ref={dropdownRef}>
      {error && (
        <p className="mb-2 text-[13px] text-red-600">{error}</p>
      )}

      {/* Dropdown trigger */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex min-h-[44px] w-full items-center justify-between rounded-xl border-[1.5px] px-3.5 py-2.5 text-left transition-all ${
          selectedTask
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-white'
        }`}
        style={{ cursor: 'pointer' }}
      >
        <span className={`flex-1 truncate text-[15px] ${
          selectedTask ? 'text-black' : 'text-gray-500'
        }`}>
          {selectedTask ? selectedTask.content : tasks.length === 0 ? 'No tasks for today' : 'Select a task...'}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Refresh button */}
          <motion.div
            whileTap={{ scale: 0.85 }}
            onClick={(e) => { e.stopPropagation(); fetchTasks() }}
            className="cursor-pointer rounded-md p-0.5 text-gray-400"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </motion.div>
          {selectedTask && (
            <motion.div
              whileTap={{ scale: 0.85 }}
              onClick={(e) => { e.stopPropagation(); onSelectTask(null) }}
              className="cursor-pointer rounded-md p-0.5 text-gray-400"
            >
              <X className="w-4 h-4" />
            </motion.div>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
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
            className="mt-1.5 max-h-[280px] origin-top overflow-hidden overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-md"
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
                  className={`flex w-full items-center gap-2.5 border-none px-3.5 py-3 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'bg-white'
                  } ${i < tasks.length - 1 ? 'border-b border-gray-100' : ''}`}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Checkbox */}
                  <div
                    className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-2 transition-all"
                    style={{
                      borderColor: isCompleted ? '#34C759' : isSelected ? '#2B79E5' : '#9CA3AF',
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

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={`m-0 truncate text-[15px] text-black ${
                      isCompleted ? 'line-through opacity-50' : ''
                    }`}>
                      {task.content}
                    </p>
                    <div className="mt-0.5 flex gap-2">
                      {task.duration && (
                        <span className="text-xs text-gray-500">
                          {task.duration.amount}min
                        </span>
                      )}
                      {task.priority > 1 && (
                        <span className={`text-xs ${
                          task.priority === 4 ? 'text-red-500' : task.priority === 3 ? 'text-orange-500' : 'text-blue-500'
                        }`}>
                          P{5 - task.priority}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Complete button */}
                  <motion.div
                    whileTap={{ scale: 0.85 }}
                    onClick={(e) => handleClose(task.id, e)}
                    className="flex-shrink-0 cursor-pointer rounded-md p-1 text-gray-400"
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
