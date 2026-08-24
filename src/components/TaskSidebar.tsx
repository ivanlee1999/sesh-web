'use client'

/**
 * Navigation for the All screen.
 *
 * The same component serves both breakpoints: from 900px up it stands beside
 * the list, and below that the screen renders it inside a drawer. It therefore
 * knows nothing about how it is presented — only which row is selected and
 * what to call when that changes.
 */

import { PROVIDER_COLOR } from '@/lib/task-sources'
import { ALL_SCOPE, type ScopeId, type ScopeRow, type Sidebar } from '@/lib/task-views'

function Row({
  row,
  active,
  onSelect,
}: {
  row: ScopeRow
  active: boolean
  onSelect: (id: ScopeId) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      aria-current={active ? 'true' : undefined}
      className={`press flex w-full items-center gap-[9px] rounded-[var(--r-sm)] border-0 px-[10px] py-[7px] text-left text-[13.5px] transition-colors ${
        active
          ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]'
          : 'bg-transparent font-medium text-[var(--ink-2)]'
      }`}
    >
      {row.provider && (
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: PROVIDER_COLOR[row.provider] }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      <span className="flex-shrink-0 text-[12px] tabular-nums text-[var(--ink-3)]">{row.count}</span>
    </button>
  )
}

function Section({
  title,
  rows,
  scope,
  onSelect,
}: {
  title: string
  rows: ScopeRow[]
  scope: ScopeId
  onSelect: (id: ScopeId) => void
}) {
  if (rows.length === 0) return null
  return (
    <div className="mb-[18px]">
      {/* Small, uppercase, letter-spaced — the iOS Settings section heading. */}
      <div className="mb-[6px] px-[10px] text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--ink-3)]">
        {title}
      </div>
      <div className="flex flex-col gap-[1px]">
        {rows.map(row => (
          <Row key={row.id} row={row} active={scope === row.id} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

export default function TaskSidebar({
  sidebar,
  scope,
  onSelect,
}: {
  sidebar: Sidebar
  scope: ScopeId
  onSelect: (id: ScopeId) => void
}) {
  return (
    <nav aria-label="Task lists" className="flex flex-col">
      <div className="mb-[18px] flex flex-col gap-[1px]">
        <Row
          row={{ id: ALL_SCOPE, label: 'All', count: sidebar.total }}
          active={scope === ALL_SCOPE}
          onSelect={onSelect}
        />
        {sidebar.views.map(row => (
          <Row key={row.id} row={row} active={scope === row.id} onSelect={onSelect} />
        ))}
      </div>
      <Section title="Areas" rows={sidebar.areas} scope={scope} onSelect={onSelect} />
      <Section title="Projects" rows={sidebar.projects} scope={scope} onSelect={onSelect} />
    </nav>
  )
}
