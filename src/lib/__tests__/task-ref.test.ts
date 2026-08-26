import { describe, expect, it } from 'vitest'
import { decodeTaskRef, decodeTaskRefs, encodeTaskRef, encodeTaskRefs, splitTaskRefs } from '../task-ref'
import { refsForProviders } from '../task-sources'

describe('task ref encoding', () => {
  it('leaves Todoist ids bare so existing rows keep working', () => {
    expect(encodeTaskRef('todoist', '6X4Vw2Hfmg')).toBe('6X4Vw2Hfmg')
  })

  it('namespaces non-Todoist providers', () => {
    expect(encodeTaskRef('things', 'ABC-123')).toBe('things:ABC-123')
  })

  it('round-trips both providers', () => {
    for (const [provider, id] of [['todoist', '123'], ['things', 'uuid-9']] as const) {
      expect(decodeTaskRef(encodeTaskRef(provider, id))).toEqual({ provider, id })
    }
  })

  it('treats a bare id as Todoist', () => {
    expect(decodeTaskRef('6X4Vw2Hfmg')).toEqual({ provider: 'todoist', id: '6X4Vw2Hfmg' })
  })

  it('does not mistake a colon inside a Todoist id for a provider prefix', () => {
    expect(decodeTaskRef('weird:id')).toEqual({ provider: 'todoist', id: 'weird:id' })
  })

  it('keeps colons in the Things uuid portion', () => {
    expect(decodeTaskRef('things:a:b')).toEqual({ provider: 'things', id: 'a:b' })
  })

  it('returns null for empty refs', () => {
    expect(decodeTaskRef(null)).toBeNull()
    expect(decodeTaskRef('')).toBeNull()
  })
})

describe('encodeTaskRefs', () => {
  it('encodes a single Todoist task as the bare id every existing row already holds', () => {
    expect(encodeTaskRefs([encodeTaskRef('todoist', '6X4Vw2')])).toBe('6X4Vw2')
  })

  it('joins several tasks, keeping each provider prefix', () => {
    expect(encodeTaskRefs(['6X4Vw2', 'things:A1-B2'])).toBe('6X4Vw2,things:A1-B2')
  })

  it('is null when nothing is picked, so the column stays empty rather than blank', () => {
    expect(encodeTaskRefs([])).toBeNull()
    expect(encodeTaskRefs(['', '  '])).toBeNull()
  })
})

describe('splitTaskRefs', () => {
  it('reads a legacy single-id value as a list of one', () => {
    expect(splitTaskRefs('6X4Vw2')).toEqual(['6X4Vw2'])
  })

  it('reads a joined value back as the refs that went in', () => {
    expect(splitTaskRefs('6X4Vw2,things:A1-B2')).toEqual(['6X4Vw2', 'things:A1-B2'])
  })

  it('treats an empty value as no tasks', () => {
    expect(splitTaskRefs(null)).toEqual([])
    expect(splitTaskRefs('')).toEqual([])
  })
})

describe('decodeTaskRefs', () => {
  it('routes each task to its own provider', () => {
    expect(decodeTaskRefs('6X4Vw2,things:A1-B2')).toEqual([
      { provider: 'todoist', id: '6X4Vw2' },
      { provider: 'things', id: 'A1-B2' },
    ])
  })

  it('round-trips a single ref exactly as decodeTaskRef would', () => {
    expect(decodeTaskRefs('things:A1-B2')).toEqual([decodeTaskRef('things:A1-B2')])
  })
})

describe('refsForProviders', () => {
  it('drops tasks belonging to a provider that has been switched off', () => {
    expect(refsForProviders('6X4Vw2,things:A1-B2', ['things'])).toEqual(['things:A1-B2'])
  })

  it('keeps every task while both providers are on', () => {
    expect(refsForProviders('6X4Vw2,things:A1-B2', ['todoist', 'things'])).toEqual(['6X4Vw2', 'things:A1-B2'])
  })

  it('is empty when the only linked provider is off', () => {
    expect(refsForProviders('6X4Vw2', ['things'])).toEqual([])
  })
})
