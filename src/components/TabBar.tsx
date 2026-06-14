'use client'
import { Icon, type IconName } from './sesh-ui'

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
  return (
    <div className="tabbar-frosted">
      <div className="flex rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--nav-bg)] p-1.5 shadow-[0_8px_30px_rgba(30,22,12,0.16)] backdrop-blur-[20px] [backdrop-filter:blur(20px)_saturate(180%)]">
        {tabs.map(({ id, label, icon }) => {
          const active = activeTab === id
          return (
            <button
              type="button"
              key={id}
              onClick={() => onChange(id)}
              className="flex flex-1 flex-col items-center gap-1 rounded-[var(--r-pill)] border-0 px-0.5 py-2"
              style={{ background: active ? 'var(--accent-soft)' : 'transparent' }}
            >
              <Icon name={icon} size={20} color={active ? 'var(--accent-ink)' : 'var(--ink-3)'} stroke={1.7} />
              <span
                className="text-[10px] font-semibold tracking-[0.005em]"
                style={{ color: active ? 'var(--accent-ink)' : 'var(--ink-3)' }}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
