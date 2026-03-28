'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Timer from './Timer'
import SessionLog from './SessionLog'
import Settings from './Settings'
import TabBar, { type AppTab } from './TabBar'

const viewTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] },
}

export default function AppLayout() {
  const [activeTab, setActiveTab] = useState<AppTab>('timer')

  return (
    <div className="app-shell">
      <div className="view-stack">
        {/* Timer is always mounted — hidden via CSS when not active */}
        <section
          style={{
            display: activeTab === 'timer' ? 'block' : 'none',
          }}
          aria-hidden={activeTab !== 'timer'}
        >
          <Timer />
        </section>

        {/* Log and Settings mount/unmount with animation */}
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === 'log' && (
            <motion.section key="log" {...viewTransition}>
              <SessionLog />
            </motion.section>
          )}
          {activeTab === 'settings' && (
            <motion.section key="settings" {...viewTransition}>
              <Settings />
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </div>
  )
}
