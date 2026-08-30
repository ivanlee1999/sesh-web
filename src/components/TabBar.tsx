'use client'

import type { CSSProperties } from 'react'
import { MdIcon, type MdIconName } from './md/icons'
import { haptic } from '@/lib/haptic'

export type AppTab = 'timer' | 'tasks' | 'calendar' | 'insights' | 'settings'

export const APP_TABS: { id: AppTab; label: string; icon: MdIconName }[] = [
  { id: 'timer', label: 'Focus', icon: 'focus' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

interface TabBarProps {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
}

/**
 * The phone's five-up bottom bar. The indicator is one absolutely positioned
 * bar a fifth of the width that translates by whole multiples of itself, so it
 * slides between tabs instead of the highlight hard-swapping.
 */
export default function TabBar({ activeTab, onChange }: TabBarProps) {
  const activeIndex = Math.max(0, APP_TABS.findIndex(tab => tab.id === activeTab))

  return (
    <nav
      aria-label="Primary"
      style={{
        flex: 'none',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        borderTop: '2px solid var(--color-divider)',
        paddingBottom: 'calc(var(--safe-b) + 8px)',
        background: 'var(--color-bg)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -2,
          left: 0,
          height: 3,
          width: '20%',
          background: 'var(--color-accent)',
          transform: `translateX(${activeIndex * 100}%)`,
          transition: 'transform 380ms var(--ease-spring)',
        } as CSSProperties}
      />
      {APP_TABS.map(({ id, label, icon }) => {
        const active = activeTab === id
        return (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={active}
            aria-label={label}
            data-active={active}
            onClick={() => {
              if (!active) haptic()
              onChange(id)
            }}
            className="md-tab md-press"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '11px 0 6px',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              color: 'var(--color-neutral-600)',
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 9.5,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
            }}
          >
            <MdIcon name={icon} size={21} strokeWidth={1.9} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
