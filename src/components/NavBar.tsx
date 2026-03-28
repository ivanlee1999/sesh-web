'use client'
import { Timer, BarChart2, History, Settings } from 'lucide-react'
import clsx from 'clsx'

type Tab = 'timer' | 'analytics' | 'history' | 'settings'

interface NavBarProps {
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
}

const tabs: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'timer', label: 'Timer', Icon: Timer },
  { id: 'analytics', label: 'Analytics', Icon: BarChart2 },
  { id: 'history', label: 'History', Icon: History },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

export default function NavBar({ activeTab, setActiveTab }: NavBarProps) {
  return (
    <>
      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 z-50">
        <div className="max-w-2xl mx-auto flex">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex-1 flex flex-col items-center py-2 gap-1 text-xs transition-colors',
                activeTab === id
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Desktop top nav */}
      <nav className="hidden md:flex fixed top-0 left-0 right-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-50">
        <div className="max-w-2xl mx-auto w-full flex items-center px-4">
          <span className="font-semibold text-gray-800 dark:text-gray-100 mr-8 py-3">sesh</span>
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === id
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </>
  )
}
