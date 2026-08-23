import { describe, expect, it } from 'vitest'
import { decodeTaskRef, encodeTaskRef } from '../task-ref'

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
