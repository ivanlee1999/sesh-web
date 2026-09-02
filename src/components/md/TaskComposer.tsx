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
    <div className="md-rule-b" style={{ flex: 'none', padding: compact ? '8px 12px' : '10px 16px' }}>
      <div
        className="md-field"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 4px 0 12px',
          minHeight: 40,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: 'none',
            width: 7,
            height: 7,
            borderRadius: 4,
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
            padding: '8px 0',
            outline: 'none',
            boxShadow: 'none',
          }}
        />
        {title.trim() && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void submit()}
            disabled={busy}
            aria-label={`Add “${title.trim()}” to ${destination}`}
            style={{ flex: 'none', gap: 6 }}
          >
            {busy ? 'Adding' : 'Add'}
            {!busy && <MdIcon name="arrow" size={14} strokeWidth={2.2} color="var(--accent-on)" />}
          </button>
        )}
      </div>
      {error && (
        <div
          style={{
            padding: '6px 4px 0',
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--warn)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
