export type Category = string
export type SessionType = 'focus' | 'break'
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
  rating?: number
  todoistTaskId?: string | null
}

export interface TodoistTask {
  id: string
  content: string
  duration: { amount: number; unit: 'minute' } | null
  labels: string[]
  priority: number
  projectId?: string | null
  projectName?: string
  due?: 'today' | 'tomorrow' | 'upcoming' | null
  dueLabel?: string | null
  category?: string | null
  completed?: boolean
}

export interface AppSettings {
  focusDuration: number    // minutes
  breakDuration: number
  soundEnabled: boolean
  calendarSync: boolean
  darkMode: boolean
  keepScreenAwake: boolean
  autoStartBreak: boolean
  todoistAutoComplete: boolean
  accentColor: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  focusDuration: 25,
  breakDuration: 5,
  soundEnabled: true,
  calendarSync: false,
  darkMode: false,
  keepScreenAwake: true,
  autoStartBreak: true,
  todoistAutoComplete: true,
  accentColor: '#BE6E45',
}
