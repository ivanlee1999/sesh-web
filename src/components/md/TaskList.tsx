'use client'

import type { CSSProperties } from 'react'
import { MdIcon } from './icons'
import type { CappedGroup } from '@/lib/modernist'

/**
 * The merged task list. One component behind the Tasks screen, the desktop
 * focus rail and the phone picker sheet, so a row looks and behaves the same
 * wherever the queue is shown.
 */

export interface TaskRowModel {
  key: string
  title: string
  project: string
  due: string
  est: string
  /** Provider brand colour, drawn as a square — never a circle. */
  dot: string
  selected: boolean
  completing: boolean
  /** Overrides the body button's label — screens word the toggle differently. */
  ariaLabel?: string
  /** Body tap. Adds or removes the task from the next session. */
  onPick: () => void
  /** The FOCUS button. Points the session at this task alone. */
  onFocus: () => void
  onComplete: () => void
}

export default function TaskList({
  groups,
  emptyLabel = 'Nothing here. Both providers report clean.',
}: {
  groups: CappedGroup<TaskRowModel>[]
  emptyLabel?: string
}) {
  const empty = groups.every(group => group.rows.length === 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', color: 'var(--color-text)' }}>
      {groups.map(group => (
        <div key={group.label} style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              padding: '14px 14px 6px',
              // No rule under a group header. The label is already uppercase,
              // 800 and tracked — a 2px rule under each of four groups made the
              // list read as four boxed tables rather than one list.
              position: 'sticky',
              top: 0,
              background: 'var(--color-bg)',
              zIndex: 2,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 11,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
              }}
            >
              {group.label}
            </span>
            <span className="md-num" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
              {group.total}
            </span>
          </div>

          {group.rows.map(row => (
            <div
              key={row.key}
              className="md-row md-hairline"
              data-selected={row.selected ? 'true' : 'false'}
              data-completing={row.completing ? 'true' : 'false'}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 11,
                padding: '8px 14px 9px',
                // Starts at the title, past the checkbox.
                '--hairline-inset': '45px',
                transition: 'background 160ms var(--ease-out)',
              } as CSSProperties}
            >
              <button
                type="button"
                className="md-box"
                onClick={row.onComplete}
                aria-label={`Complete ${row.title}`}
                style={{
                  flex: 'none',
                  width: 20,
                  height: 20,
                  marginTop: 1,
                  border: '2px solid var(--color-neutral-500)',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 140ms var(--ease-spring), background 160ms, border-color 160ms',
                }}
              >
                <MdIcon
                  name="check"
                  size={14}
                  strokeWidth={3.4}
                  color="var(--color-accent)"
                  style={{ opacity: row.completing ? 1 : 0 }}
                />
              </button>

              <button
                type="button"
                onClick={row.onPick}
                aria-label={row.ariaLabel}
                aria-pressed={row.ariaLabel ? row.selected : undefined}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'inherit',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.35, textWrap: 'pretty' }}>
                  {row.title}
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    flexWrap: 'wrap',
                    fontSize: 10.5,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: 'var(--color-neutral-600)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, background: row.dot, display: 'inline-block' }} />
                    {row.project}
                  </span>
                  {row.due && <span>{row.due}</span>}
                  {row.est && <span className="md-num">{row.est}</span>}
                </span>
              </button>

              <button
                type="button"
                className="md-row-go"
                aria-label={`Focus on ${row.title}`}
                onClick={row.onFocus}
                style={{
                  flex: 'none',
                  opacity: row.selected ? 1 : 0,
                  transform: 'translateX(4px)',
                  transition: 'opacity 180ms, transform 180ms var(--ease-spring)',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  border: 0,
                  padding: '5px 9px',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 800,
                  fontSize: 10,
                  letterSpacing: '.09em',
                  cursor: 'pointer',
                }}
              >
                FOCUS
              </button>
            </div>
          ))}

          {group.more && (
            <div
              style={{
                padding: '7px 14px 8px',
                fontSize: 10.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'var(--color-neutral-600)',
              }}
            >
              {group.more}
            </div>
          )}
        </div>
      ))}

      {empty && (
        <div
          style={{
            padding: '28px 16px',
            color: 'var(--color-neutral-600)',
            fontSize: 12.5,
          }}
        >
          {emptyLabel}
        </div>
      )}
    </div>
  )
}
