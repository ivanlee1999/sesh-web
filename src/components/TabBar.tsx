'use client'
import { Clock, History, BarChart2, Tag, Settings } from 'lucide-react'

export type AppTab = 'timer' | 'history' | 'analytics' | 'categories' | 'settings'

interface TabBarProps {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
}

const tabs: { id: AppTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'timer', label: 'Timer', Icon: Clock },
  { id: 'history', label: 'History', Icon: History },
  { id: 'analytics', label: 'Analytics', Icon: BarChart2 },
  { id: 'categories', label: 'Categories', Icon: Tag },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

export default function TabBar({ activeTab, onChange }: TabBarProps) {
  return (
    <div className="tabbar-frosted">
      <div className="mx-auto flex max-w-[480px] items-end justify-around px-2 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2">
        {tabs.map(({ id, label, Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`flex flex-col items-center gap-0.5 border-none bg-transparent px-2 py-1 ${
                active
                  ? 'text-blue-500 dark:text-blue-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[9px] font-medium tracking-tight">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
