'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Check } from 'lucide-react'
import {
  List,
  ListItem,
  Button,
  Badge,
  Sheet,
  Toolbar,
} from 'konsta/react'
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
  const [sheetOpened, setSheetOpened] = useState(false)

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
        <p className="mb-2 text-[13px] text-red-600">{error}</p>
      )}

      {/* Trigger — Konsta List row */}
      <List strong inset className="!my-0">
        <ListItem
          link
          title={triggerText}
          after={
            <span
              className="cursor-pointer p-1 text-black dark:text-white"
              onClick={(e) => { e.stopPropagation(); fetchTasks() }}
              style={{ opacity: loading ? 0.5 : 1 }}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </span>
          }
          onClick={() => setSheetOpened(true)}
          className={selectedTask ? '!bg-blue-50 dark:!bg-blue-950' : ''}
        />
      </List>

      {selectedTask && (
        <div className="mt-1 flex justify-center">
          <Button small clear onClick={() => onSelectTask(null)} className="!text-gray-500">
            Clear selection
          </Button>
        </div>
      )}

      {/* Task selection sheet */}
      <Sheet
        opened={sheetOpened}
        onBackdropClick={() => setSheetOpened(false)}
        className="!max-h-[70vh]"
      >
        <Toolbar top>
          <div className="flex w-full items-center justify-between px-2">
            <Button clear small onClick={() => { fetchTasks() }}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <span className="text-sm font-semibold text-black dark:text-white">Tasks</span>
            <Button clear small onClick={() => setSheetOpened(false)}>
              Done
            </Button>
          </div>
        </Toolbar>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 44px)' }}>
          <List strong inset className="!my-2">
            {tasks.map((task) => {
              const isSelected = selectedTaskId === task.id
              const isCompleted = completedId === task.id
              const isClosing = closingId === task.id

              const subtitle = [
                task.duration ? `${task.duration.amount}min` : null,
              ].filter(Boolean).join(' · ')

              return (
                <ListItem
                  key={task.id}
                  title={
                    <span className={`text-black dark:text-white ${isCompleted ? 'line-through opacity-50' : ''}`}>
                      {task.content}
                    </span>
                  }
                  subtitle={subtitle || undefined}
                  after={
                    <div className="flex items-center gap-2">
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
                      <span
                        className="cursor-pointer rounded-md p-1 text-black dark:text-white"
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
                      </span>
                    </div>
                  }
                  media={
                    <div
                      className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-2"
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
                  }
                  onClick={() => {
                    onSelectTask(isSelected ? null : task)
                    setSheetOpened(false)
                  }}
                  className={isSelected ? '!bg-blue-50 dark:!bg-blue-950' : ''}
                />
              )
            })}
          </List>
        </div>
      </Sheet>
    </div>
  )
}
