'use client'

/**
 * The All screen's list controls.
 *
 * Deliberately a single quiet row rather than a panel: these change how a list
 * reads, so they should sit near it without competing with it. Each control
 * shows its current value, so the state of the list is legible without opening
 * anything.
 */

import {
  GROUP_LABEL,
  SORT_LABEL,
  type AllOptions,
  type GroupKey,
  type SortKey,
} from '@/lib/task-views'

const SELECT_CLASS =
  'press cursor-pointer appearance-none rounded-[var(--r-sm)] border border-[var(--line)] '
  + 'bg-[var(--surface)] py-[5px] pl-[9px] pr-[22px] text-[12.5px] font-medium text-[var(--ink-2)]'

/** A caret drawn in CSS, so the control matches in both themes. */
const CARET =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'>"
  + "<path d='M3 4.5L6 8l3-3.5' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round'/></svg>\")"

const caretStyle = {
  backgroundImage: CARET,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  backgroundSize: '12px 12px',
}

export default function TaskListOptions({
  options,
  tags,
  onChange,
}: {
  options: AllOptions
  tags: string[]
  onChange: (next: AllOptions) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      <label className="flex items-center gap-[5px]">
        <span className="text-[12px] text-[var(--ink-3)]">Sort</span>
        <select
          className={SELECT_CLASS}
          style={caretStyle}
          value={options.sort}
          onChange={e => onChange({ ...options, sort: e.target.value as SortKey })}
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map(key => (
            <option key={key} value={key}>{SORT_LABEL[key]}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-[5px]">
        <span className="text-[12px] text-[var(--ink-3)]">Group</span>
        <select
          className={SELECT_CLASS}
          style={caretStyle}
          value={options.group}
          onChange={e => onChange({ ...options, group: e.target.value as GroupKey })}
        >
          {(Object.keys(GROUP_LABEL) as GroupKey[]).map(key => (
            <option key={key} value={key}>{GROUP_LABEL[key]}</option>
          ))}
        </select>
      </label>

      {tags.length > 0 && (
        <label className="flex items-center gap-[5px]">
          <span className="text-[12px] text-[var(--ink-3)]">Tag</span>
          <select
            className={SELECT_CLASS}
            style={caretStyle}
            value={options.tag ?? ''}
            onChange={e => onChange({ ...options, tag: e.target.value || null })}
          >
            <option value="">Any</option>
            {tags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        onClick={() => onChange({ ...options, hideUndated: !options.hideUndated })}
        aria-pressed={options.hideUndated}
        className={`press rounded-[var(--r-sm)] border px-[10px] py-[5px] text-[12.5px] font-medium transition-colors ${
          options.hideUndated
            ? 'border-transparent bg-[var(--accent)] text-white'
            : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]'
        }`}
      >
        Dated only
      </button>
    </div>
  )
}
