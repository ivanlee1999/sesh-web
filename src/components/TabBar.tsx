'use client'
import { Clock, History, BarChart2, Tag, Settings } from 'lucide-react'
import { motion } from 'framer-motion'

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
    <nav className="tabbar">
      <div className="tabbar-inner">
        {tabs.map(({ id, label, Icon }) => (
          <motion.button
            key={id}
            whileTap={{ scale: 0.92 }}
            onClick={() => onChange(id)}
            className={`tabbar-item ${activeTab === id ? 'tabbar-item--active' : 'tabbar-item--inactive'}`}
          >
            <Icon />
            <span>{label}</span>
          </motion.button>
        ))}
      </div>
    </nav>
  )
}
