import { describe, expect, it } from 'vitest'
import { joinIntention, rankIntentionHistory, splitIntention, suggestIntentionItems } from '../intention-items'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

describe('intention items', () => {
  it('splits and joins in the form picking several tasks writes', () => {
    expect(splitIntention('Draft memo · Book the room')).toEqual(['Draft memo', 'Book the room'])
    expect(splitIntention('  ')).toEqual([])
    expect(joinIntention(['Draft memo', ' ', 'Book the room '])).toBe('Draft memo · Book the room')
  })

  it('ranks recent and frequent items first, merging case', () => {
    const ranked = rankIntentionHistory([
      { intention: 'old thing', startedAt: NOW - 200 * DAY },
      { intention: 'old thing', startedAt: NOW - 201 * DAY },
      { intention: 'old thing', startedAt: NOW - 202 * DAY },
      { intention: 'review PR · inbox', startedAt: NOW - 2 * DAY },
      { intention: 'Review PR', startedAt: NOW - DAY },
    ], NOW)
    expect(ranked.map(item => item.text)).toEqual(['Review PR', 'inbox', 'old thing'])
  })

  it('offers prefix matches before substring matches, skipping chosen items', () => {
    const ranked = rankIntentionHistory([
      { intention: 'Code review', startedAt: NOW },
      { intention: 'Review PR', startedAt: NOW - DAY },
      { intention: 'Reading', startedAt: NOW - 2 * DAY },
    ], NOW)
    expect(suggestIntentionItems(ranked, 're')).toEqual(['Review PR', 'Reading', 'Code review'])
    expect(suggestIntentionItems(ranked, 're', ['reading'])).toEqual(['Review PR', 'Code review'])
    expect(suggestIntentionItems(ranked, '')).toEqual(['Code review', 'Review PR', 'Reading'])
    expect(suggestIntentionItems(ranked, 'review pr')).toEqual([])
  })
})
