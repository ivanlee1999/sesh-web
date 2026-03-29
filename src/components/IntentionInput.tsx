'use client'
import type { Category } from '@/types'
import { useCategories } from '@/context/CategoriesContext'
import { motion } from 'framer-motion'

interface IntentionInputProps {
  intention: string
  setIntention: (v: string) => void
  category: Category
  setCategory: (v: Category) => void
}

export default function IntentionInput({ intention, setIntention, category, setCategory }: IntentionInputProps) {
  const { categories } = useCategories()

  return (
    <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        type="text"
        value={intention}
        onChange={e => setIntention(e.target.value)}
        placeholder="What are you working on?"
        maxLength={120}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: 15,
          outline: 'none',
          transition: 'border-color 0.2s ease',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
        onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {categories.map(cat => {
          const isActive = category === cat.name
          return (
            <motion.button
              key={cat.name}
              whileTap={{ scale: 0.95 }}
              onClick={() => setCategory(cat.name)}
              style={{
                padding: '5px 12px',
                borderRadius: 8,
                border: `1.5px solid ${isActive ? cat.color : 'var(--border)'}`,
                background: isActive ? cat.color : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {cat.label}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
