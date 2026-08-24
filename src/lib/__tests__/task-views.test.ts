import { describe, expect, it } from 'vitest'
import type { ExternalTask } from '@/types'
import {
  ALL_SCOPE,
  DEFAULT_ALL_OPTIONS,
  applyAllOptions,
  areaScope,
  availableTags,
  bucketScope,
  buildSidebar,
  projectScope,
  sectionize,
} from '../task-views'

function task(partial: Partial<ExternalTask> & { id: string; content: string }): ExternalTask {
  return {
    provider: 'things',
    duration: null,
    labels: [],
    priority: 4,
    completed: false,
    ...partial,
  } as ExternalTask
}

const TASKS: ExternalTask[] = [
  task({ id: '1', content: 'Anki', bucket: 'today', dueDate: '2026-08-24', dueLabel: 'Today', projectName: 'Française', areaName: 'Langues', priority: 2 }),
  task({ id: '2', content: 'RCA routing', bucket: 'upcoming', dueDate: '2026-08-25', dueLabel: 'Tomorrow', projectName: 'Things', priority: 1 }),
  task({ id: '3', content: 'Escape earth', bucket: 'anytime', projectName: 'Things', labels: ['dream'] }),
  task({ id: '4', content: 'Resume', bucket: 'anytime', projectName: 'Applications', areaName: 'Career' }),
  task({ id: '5', content: 'Someday thing', bucket: 'someday', projectName: 'Applications', areaName: 'Career' }),
  task({ id: '6', content: 'Inbox note', bucket: 'inbox', projectName: 'Things' }),
  task({ id: '7', content: 'Finished', bucket: 'anytime', projectName: 'Things', completed: true }),
]

describe('the All sidebar', () => {
  it('counts each pile, area and project, ignoring finished work', () => {
    const sidebar = buildSidebar(TASKS)

    expect(sidebar.total).toBe(6)
    expect(sidebar.views.map(v => [v.label, v.count])).toEqual([
      ['Inbox', 1], ['Anytime', 2], ['Someday', 1],
    ])
    expect(sidebar.areas.map(a => [a.label, a.count])).toEqual([['Career', 2], ['Langues', 1]])
    expect(sidebar.projects.find(p => p.label === 'Things')?.count).toBe(3)
  })

  /** A row that opens an empty list is worse than no row. */
  it('leaves out a pile with nothing in it', () => {
    const sidebar = buildSidebar([task({ id: '1', content: 'Only one', bucket: 'inbox' })])
    expect(sidebar.views.map(v => v.label)).toEqual(['Inbox'])
  })
})

describe('narrowing to one sidebar row', () => {
  it('scopes to a pile, an area or a project', () => {
    const pick = (scope: string) =>
      applyAllOptions(TASKS, { ...DEFAULT_ALL_OPTIONS, scope }).map(t => t.id)

    expect(pick(ALL_SCOPE)).toHaveLength(6)
    // Both undated, so they tie-break on title: "Escape earth" before "Resume".
    expect(pick(bucketScope('anytime'))).toEqual(['3', '4'])
    expect(pick(areaScope('Career'))).toEqual(['4', '5'])
    expect(pick(projectScope('things', 'Applications'))).toEqual(['4', '5'])
  })
})

describe('the list options', () => {
  it('sorts dated work first and undated last, whatever the key', () => {
    const byDate = applyAllOptions(TASKS, { ...DEFAULT_ALL_OPTIONS, sort: 'date' })
    expect(byDate.slice(0, 2).map(t => t.id)).toEqual(['1', '2'])
    expect(byDate.slice(2).every(t => !t.dueDate)).toBe(true)

    const byPriority = applyAllOptions(TASKS, { ...DEFAULT_ALL_OPTIONS, sort: 'priority' })
    expect(byPriority.slice(0, 2).map(t => t.id)).toEqual(['2', '1'])
  })

  it('drops undated work on request', () => {
    const dated = applyAllOptions(TASKS, { ...DEFAULT_ALL_OPTIONS, hideUndated: true })
    expect(dated.map(t => t.id)).toEqual(['1', '2'])
  })

  it('filters on a tag or a category, case-insensitively', () => {
    expect(applyAllOptions(TASKS, { ...DEFAULT_ALL_OPTIONS, tag: 'DREAM' }).map(t => t.id)).toEqual(['3'])
    expect(availableTags(TASKS)).toEqual(['dream'])
  })

  it('never returns completed work', () => {
    expect(applyAllOptions(TASKS, DEFAULT_ALL_OPTIONS).some(t => t.id === '7')).toBe(false)
  })
})

describe('grouping the list', () => {
  it('groups by project, by date, or not at all', () => {
    const sorted = applyAllOptions(TASKS, DEFAULT_ALL_OPTIONS)

    expect(sectionize(sorted, 'project').map(s => s.title))
      .toEqual(['Française', 'Things', 'Applications'])
    expect(sectionize(sorted, 'date').map(s => s.title))
      .toEqual(['Today', 'Tomorrow', 'No date'])

    const flat = sectionize(sorted, 'none')
    expect(flat).toHaveLength(1)
    expect(flat[0].title).toBe('')
    expect(flat[0].items).toHaveLength(6)
  })

  /** Grouping must not quietly undo the sort the user just chose. */
  it('keeps sections in the order the sort produced', () => {
    const byPriority = applyAllOptions(TASKS, { ...DEFAULT_ALL_OPTIONS, sort: 'priority' })
    expect(sectionize(byPriority, 'project')[0].title).toBe('Things')
  })

  it('returns nothing for an empty list rather than an empty section', () => {
    expect(sectionize([], 'none')).toEqual([])
    expect(sectionize([], 'project')).toEqual([])
  })
})
