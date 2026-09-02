'use client'

import { MdIcon } from './icons'
import ResizeHandle from './ResizeHandle'
import { usePaneWidth } from '@/hooks/usePaneWidth'
import { APP_TABS, type AppTab } from '../TabBar'
import { PROVIDER_COLOR, PROVIDER_LABEL } from '@/lib/task-sources'
import type { TaskProvider } from '@/types'

/**
 * The desktop's permanent left rail. Replaces the bottom bar entirely rather
 * than sitting alongside it, and is hidden outright while a session runs so
 * focus mode is genuinely full-bleed.
 */
/** The designed width, and how far it may be taken from it. */
export const RAIL_BOUNDS = { min: 168, max: 340, fallback: 214 }

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
  const rail = usePaneWidth('rail', RAIL_BOUNDS)

  return (
    <>
    <aside
      style={{
        flex: 'none',
        width: rail.width,
        // The border moves to the handle, which is the same hairline.
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0 0',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 20px 18px' }}>
        <strong style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 19, letterSpacing: '-.02em' }}>
          sesh
        </strong>
      </div>
      <div style={{ height: 1, background: 'var(--line)', margin: '0 12px' }} />

      <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 10px' }}>
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
                gap: 11,
                minHeight: 40,
                padding: '0 12px',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: 0,
                color: active ? 'var(--color-text)' : 'var(--color-text-2)',
                textAlign: 'left',
              }}
            >
              <MdIcon name={icon} size={18} strokeWidth={1.8} />
              {label}
              {id === 'tasks' && openTasks !== null && (
                <span
                  className="md-num"
                  style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: 'var(--color-text-2)' }}
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
          borderTop: '1px solid var(--line)',
          margin: 'auto 12px 0',
          padding: '14px 8px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span className="md-eyebrow">Sources</span>
        {sources.map(({ provider, state }) => (
          <span key={provider} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 500 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: PROVIDER_COLOR[provider], display: 'block', flex: 'none' }} />
            {PROVIDER_LABEL[provider]}
            <span style={{ marginLeft: 'auto', color: 'var(--color-text-2)' }}>{state}</span>
          </span>
        ))}
      </div>
    </aside>
    <ResizeHandle
      label="Navigation width"
      width={rail.width}
      min={RAIL_BOUNDS.min}
      max={RAIL_BOUNDS.max}
      dragging={rail.dragging}
      towards="start"
      onStart={rail.startDrag}
      onNudge={rail.nudge}
      onReset={rail.reset}
    />
    </>
  )
}
