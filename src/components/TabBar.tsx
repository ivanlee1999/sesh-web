'use client'
import { Clock, List, Settings } from 'lucide-react'
import { motion } from 'framer-motion'

export type AppTab = 'timer' | 'log' | 'settings'

interface TabBarProps {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
}

const tabs: { id: AppTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'timer', label: 'Timer', Icon: Clock },
  { id: 'log', label: 'Log', Icon: List },
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
