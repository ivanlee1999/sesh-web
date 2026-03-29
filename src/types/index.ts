export type Category = string
export type SessionType = 'focus' | 'short-break' | 'long-break'
export type TimerPhase = 'idle' | 'running' | 'paused' | 'overflow' | 'finished'

export interface CategoryRecord {
  id: string
  name: string
  label: string
  color: string
  sortOrder: number
  isDefault: boolean
}

export interface Session {
  id: string
  intention: string
  category: Category
  type: SessionType
  targetMs: number
  actualMs: number
  overflowMs: number
  startedAt: number
  endedAt: number
  notes: string
  todoistTaskId?: string | null
}

export interface TodoistTask {
  id: string
  content: string
  duration: { amount: number; unit: 'minute' } | null
  labels: string[]
  priority: number
}

export interface AppSettings {
  focusDuration: number    // minutes
  shortBreakDuration: number
  longBreakDuration: number
  soundEnabled: boolean
  calendarSync: boolean
  darkMode: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 20,
  soundEnabled: true,
  calendarSync: false,
  darkMode: false,
}
