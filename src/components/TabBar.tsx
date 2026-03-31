'use client'
import { Clock, History, BarChart2, Tag, Settings } from 'lucide-react'
import { Tabbar, TabbarLink } from 'konsta/react'

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
    <Tabbar labels icons className="tabbar-fixed">
      {tabs.map(({ id, label, Icon }) => (
        <TabbarLink
          key={id}
          active={activeTab === id}
          onClick={() => onChange(id)}
          icon={<Icon className="w-5 h-5" />}
          label={label}
        />
      ))}
    </Tabbar>
  )
}
