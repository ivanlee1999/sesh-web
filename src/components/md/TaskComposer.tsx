'use client'

import { useState } from 'react'
import { MdIcon } from './icons'
import { PROVIDER_COLOR, PROVIDER_LABEL, createTask, type NewTaskWhen } from '@/lib/task-sources'

/**
 * Add a to-do without leaving sesh.
 *
 * One row rather than a form: a title, and the list it lands in is decided by
 * where you are rather than by a picker. On Today that means Today; anywhere
 * else it means the Inbox, which is where Things itself puts loose capture.
 * The alternative — filing everything under Today — quietly turns someone's
 * Today list into an inbox, which is the one thing it must not become.
 *
 * Only Things is offered. Nothing in sesh has needed to create a Todoist task,
 * and a control that silently does nothing for one provider is worse than one
 * that is honestly absent.
 */
export default function TaskComposer({
  scope,
  onCreated,
  compact,
}: {
  /** The list being looked at, which decides where a new to-do is filed. */
  scope: 'today' | 'upcoming' | 'all'
  onCreated: () => void
  /** The queue rail and sheet are narrower than the Tasks screen. */
  compact?: boolean
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const when: NewTaskWhen = scope === 'today' ? 'today' : 'inbox'
  const destination = when === 'today' ? 'Today' : 'Inbox'

  const submit = async () => {
    const trimmed = title.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await createTask('things', { title: trimmed, when })
      setTitle('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the to-do')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ flex: 'none', borderBottom: '2px solid var(--color-divider)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <span
          aria-hidden="true"
          style={{
            flex: 'none',
            width: 8,
            height: 8,
            margin: compact ? '14px 0 0 14px' : '15px 0 0 16px',
            background: PROVIDER_COLOR.things,
          }}
        />
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void submit()
            if (event.key === 'Escape') { setTitle(''); setError(null) }
          }}
          disabled={busy}
          aria-label={`Add a to-do to ${PROVIDER_LABEL.things} ${destination}`}
          placeholder={`Add to ${destination}…`}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
            // 16px or iOS zooms the page when it takes focus.
            fontSize: 16,
            fontWeight: 500,
            padding: compact ? '9px 12px' : '10px 14px',
            outline: 'none',
          }}
        />
        {title.trim() && (
          <button
            type="button"
            className="md-press"
            onClick={() => void submit()}
            disabled={busy}
            aria-label={`Add “${title.trim()}” to ${destination}`}
            style={{
              flex: 'none',
              border: 0,
              borderLeft: '2px solid var(--color-divider)',
              background: 'var(--color-accent)',
              color: '#fff',
              padding: '0 13px',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 10.5,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            {busy ? 'Adding' : 'Add'}
            {!busy && <MdIcon name="arrow" size={14} strokeWidth={2.4} color="#fff" />}
          </button>
        )}
      </div>
      {error && (
        <div
          style={{
            padding: compact ? '0 14px 8px 30px' : '0 16px 8px 32px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--color-accent)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
