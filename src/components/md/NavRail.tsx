'use client'

import { MdIcon } from './icons'
import { APP_TABS, type AppTab } from '../TabBar'
import { PROVIDER_COLOR, PROVIDER_LABEL } from '@/lib/task-sources'
import type { TaskProvider } from '@/types'

/**
 * The desktop's permanent left rail. Replaces the bottom bar entirely rather
 * than sitting alongside it, and is hidden outright while a session runs so
 * focus mode is genuinely full-bleed.
 */
export default function NavRail({
  activeTab,
  onChange,
  openTasks,
  sources,
}: {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
  openTasks: number | null
  sources: { provider: TaskProvider; state: string }[]
}) {
  return (
    <aside
      style={{
        flex: 'none',
        width: 214,
        borderRight: '2px solid var(--color-divider)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px 20px' }}>
        <span style={{ width: 20, height: 20, background: 'var(--color-accent)', display: 'block' }} />
        <strong style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>
          sesh
        </strong>
      </div>
      <div style={{ height: 2, background: 'var(--color-divider)' }} />

      <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', padding: '10px 0' }}>
        {APP_TABS.map(({ id, label, icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              onClick={() => onChange(id)}
              className="md-rail-item md-press"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'inherit',
                textAlign: 'left',
              }}
            >
              <MdIcon name={icon} size={17} strokeWidth={1.9} />
              {label}
              {id === 'tasks' && openTasks !== null && (
                <span
                  className="md-num"
                  style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}
                >
                  {openTasks}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div
        style={{
          marginTop: 'auto',
          borderTop: '2px solid var(--color-divider)',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--color-neutral-600)',
            fontWeight: 700,
          }}
        >
          Sources
        </span>
        {sources.map(({ provider, state }) => (
          <span key={provider} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span style={{ width: 7, height: 7, background: PROVIDER_COLOR[provider], display: 'block', flex: 'none' }} />
            {PROVIDER_LABEL[provider]}
            <span style={{ marginLeft: 'auto', color: 'var(--color-neutral-600)' }}>{state}</span>
          </span>
        ))}
      </div>
    </aside>
  )
}
