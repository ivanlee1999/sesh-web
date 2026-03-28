export type Category = 'development' | 'writing' | 'design' | 'learning' | 'exercise' | 'other'
export type SessionType = 'focus' | 'short-break' | 'long-break'
export type TimerPhase = 'idle' | 'running' | 'paused' | 'overflow' | 'finished'

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

export const CATEGORY_COLORS: Record<Category, string> = {
  development: '#3b82f6',
  writing: '#8b5cf6',
  design: '#ec4899',
  learning: '#f59e0b',
  exercise: '#10b981',
  other: '#6b7280',
}

export const CATEGORY_LABELS: Record<Category, string> = {
  development: 'Development',
  writing: 'Writing',
  design: 'Design',
  learning: 'Learning',
  exercise: 'Exercise',
  other: 'Other',
}
