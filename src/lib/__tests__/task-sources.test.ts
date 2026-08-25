import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types'
import { TASK_PROVIDERS, enabledProviders } from '../task-sources'

describe('which task providers are used', () => {
  it('uses both by default', () => {
    expect(enabledProviders(DEFAULT_SETTINGS)).toEqual([...TASK_PROVIDERS])
  })

  it('drops Todoist when it is switched off', () => {
    expect(enabledProviders({ todoistEnabled: false })).toEqual(['things'])
  })

  /**
   * The setting arrives from the server and from localStorage, either of which
   * can predate it. Absent must mean on, or an upgrade would silently take
   * Todoist away from someone using it.
   */
  it('treats an absent setting as on', () => {
    expect(enabledProviders({})).toEqual([...TASK_PROVIDERS])
    expect(enabledProviders({ todoistEnabled: undefined })).toEqual([...TASK_PROVIDERS])
  })

  it('never drops Things', () => {
    expect(enabledProviders({ todoistEnabled: false })).toContain('things')
  })
})
