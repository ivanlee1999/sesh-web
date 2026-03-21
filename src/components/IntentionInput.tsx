'use client'
import type { Category } from '@/types'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/types'
import clsx from 'clsx'

interface IntentionInputProps {
  intention: string
  setIntention: (v: string) => void
  category: Category
  setCategory: (v: Category) => void
}

export default function IntentionInput({ intention, setIntention, category, setCategory }: IntentionInputProps) {
  return (
    <div className="w-full max-w-sm flex flex-col gap-3">
      <input
        type="text"
        value={intention}
        onChange={e => setIntention(e.target.value)}
        placeholder="What are you working on?"
        maxLength={120}
        className="w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border-2',
              category === cat
                ? 'text-white border-transparent shadow-sm'
                : 'bg-transparent text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300'
            )}
            style={category === cat ? { backgroundColor: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat] } : {}}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>
    </div>
  )
}
