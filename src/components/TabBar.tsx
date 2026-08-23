'use client'
import type { CSSProperties } from 'react'
import { Icon, type IconName } from './sesh-ui'
import { haptic } from '@/lib/haptic'

export type AppTab = 'timer' | 'tasks' | 'calendar' | 'insights' | 'settings'

interface TabBarProps {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
}

const tabs: { id: AppTab; label: string; icon: IconName }[] = [
  { id: 'timer', label: 'Focus', icon: 'timer' },
  { id: 'tasks', label: 'Tasks', icon: 'list' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
]

export default function TabBar({ activeTab, onChange }: TabBarProps) {
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTab))

  return (
    <nav
      className="app-nav"
      aria-label="Primary"
      style={{ '--tab-count': tabs.length, '--tab-index': activeIndex } as CSSProperties}
    >
      <div className="app-nav-list" role="tablist">
        {/* Slides between tabs instead of hard-swapping the highlight. */}
        <span className="app-nav-indicator" aria-hidden="true" />
        {tabs.map(({ id, label, icon }) => {
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
              className="app-nav-item"
            >
              <Icon name={icon} size={20} stroke={active ? 1.9 : 1.7} className="app-nav-icon" />
              <span className="app-nav-label">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
