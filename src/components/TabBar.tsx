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
        borderTop: '1px solid var(--line)',
        paddingBottom: 'calc(var(--safe-b) + 6px)',
        background: 'var(--color-bg)',
      }}
    >
      {/* A short rounded bar, centred in a fifth of the width; the fifth is
          what moves, so the bar lands under whichever tab is active. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -1,
          left: 0,
          width: '20%',
          height: 2,
          display: 'flex',
          justifyContent: 'center',
          transform: `translateX(${activeIndex * 100}%)`,
          transition: 'transform 320ms var(--ease-spring)',
        } as CSSProperties}
      >
        <span style={{ width: 24, height: 2, borderRadius: 1, background: 'var(--accent-base)' }} />
      </span>
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
              gap: 3,
              padding: '9px 0 5px',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              color: 'var(--color-text-2)',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 10.5,
              letterSpacing: 0,
            }}
          >
            <MdIcon name={icon} size={22} strokeWidth={active ? 2 : 1.7} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
