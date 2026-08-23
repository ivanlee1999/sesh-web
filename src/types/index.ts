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

export type TaskProvider = 'todoist' | 'things'

/**
 * A task pulled in from an external task manager. Todoist and Things both
 * normalise into this shape so the UI can show one merged list.
 *
 * `provider` is optional because older payloads (and Todoist-only fixtures)
 * predate it — always route through `resolveProvider()` rather than reading
 * it directly, so a missing value can't send a completion to the wrong app.
 */
export interface ExternalTask {
  id: string
  provider?: TaskProvider
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

/** @deprecated Prefer {@link ExternalTask}; kept so existing imports keep working. */
export type TodoistTask = ExternalTask

export function resolveProvider(task: Pick<ExternalTask, 'provider'>): TaskProvider {
  return task.provider ?? 'todoist'
}

export interface AppSettings {
  displayName: string
  focusDuration: number    // minutes
  breakDuration: number
  longBreakDuration: number
  sessionsBeforeLongBreak: number
  soundEnabled: boolean
  calendarSync: boolean
  darkMode: boolean
  keepScreenAwake: boolean
  autoStartBreak: boolean
  autoStartFocus: boolean
  todoistAutoComplete: boolean
  accentColor: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: 'there',
  focusDuration: 25,
  breakDuration: 5,
  longBreakDuration: 15,
  sessionsBeforeLongBreak: 4,
  soundEnabled: true,
  calendarSync: false,
  darkMode: false,
  keepScreenAwake: true,
  autoStartBreak: true,
  autoStartFocus: false,
  todoistAutoComplete: true,
  accentColor: '#BE6E45',
}
