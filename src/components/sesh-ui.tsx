'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { CategoryRecord } from '@/types'

export const ACCENT_OPTIONS = ['#BE6E45', '#C8943A', '#7E9476', '#6E86B0'] as const
export const CATEGORY_COLOR_OPTIONS = ['#BE6E45', '#C8943A', '#7E9476', '#6E86B0', '#9B6F8C', '#C2615A', '#5E9AA0', '#8A7B5C'] as const

const ICONS = {
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8.5"/><path d="M9.5 2.5h5"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M21 20H3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  flame: '<path d="M12 3c1.5 3 4.5 4.2 4.5 8.2A4.5 4.5 0 0 1 12 16a4.5 4.5 0 0 1-4.5-4.8C7.5 8.5 9.5 8 9.5 6c1.5.8 2.5 1.8 2.5 3 .8-1 1-2.8 0-6Z"/><path d="M12 21a5 5 0 0 0 5-5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
  sound: '<path d="M11 5 6.5 8.5H3v7h3.5L11 19z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  leaf: '<path d="M5 19c8-1 13-5 14-15C9 5 4 9 5 19Z"/><path d="M5 19c2-5 5-8 9-10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19 5l-1.8 1.8M6.8 17.2 5 19M19 19l-1.8-1.8M6.8 6.8 5 5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 7 1.5 7h-15S6 14 6 9Z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1A4 4 0 0 1 17 18z"/>',
  sync: '<path d="M4 7a8 8 0 0 1 14-2m0 0V2.5m0 2.5h-3.5"/><path d="M20 17a8 8 0 0 1-14 2m0 0V21.5m0-2.5h3.5"/>',
  apple: '<path d="M16 13c0-2.4 2-3.4 2-3.4s-1-1.6-3-1.6c-1.4 0-2 .7-3 .7s-1.7-.7-3-.7c-2.2 0-4 1.9-4 4.8 0 3 2.2 6.9 4 6.9 1 0 1.4-.7 3-.7s1.9.7 3 .7c1 0 2-1.6 2.6-3-1.6-.7-2.6-1.7-2.6-3.7Z"/><path d="M13.5 5.5c.8-1 .7-2.2.7-2.5-.9 0-1.9.6-2.4 1.2-.6.6-.8 1.5-.7 2.3.9.1 1.7-.4 2.4-1Z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  flag: '<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>',
  inbox: '<path d="M3.5 13H8a2 2 0 0 0 4 0h0a2 2 0 0 0 4 0h4.5"/><path d="M3.5 13l2.6-7.2A2 2 0 0 1 8 4.5h8a2 2 0 0 1 1.9 1.3L20.5 13v4.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  link: '<path d="M9.5 14.5l5-5"/><path d="M8 11 6 13a3.5 3.5 0 0 0 5 5l2-2"/><path d="M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/>',
} as const

export type IconName = keyof typeof ICONS

export function mixHex(a: string, b: string, wa: number) {
  const pa = a.replace('#', '')
  const pb = b.replace('#', '')
  const ai = [0, 2, 4].map(i => parseInt(pa.slice(i, i + 2), 16))
  const bi = [0, 2, 4].map(i => parseInt(pb.slice(i, i + 2), 16))
  const out = ai.map((v, i) => Math.round(v * wa + bi[i] * (1 - wa)))
  return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export function tint(color: string, pct: number) {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

export function fmtClock(totalSec: number) {
  const safe = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtHM(min: number) {
  const safe = Math.max(0, Math.round(min))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function msToHM(ms: number) {
  return fmtHM(ms / 60000)
}

export function ymd(input: Date | number | string) {
  const d = input instanceof Date ? input : new Date(input)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function Icon({
  name,
  size = 22,
  stroke = 1.6,
  color,
  style,
}: {
  name: IconName
  size?: number
  stroke?: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}

export function Ring({
  progress = 0,
  size = 272,
  stroke = 4,
  children,
  track = 'var(--line)',
  tint: ringTint = 'var(--accent)',
  ticks = 60,
  tickColor = 'var(--ink-3)',
  dot = false,
}: {
  progress?: number
  size?: number
  stroke?: number
  children?: ReactNode
  track?: string
  tint?: string
  ticks?: number
  tickColor?: string
  dot?: boolean
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, progress))
  const isHex = typeof ringTint === 'string' && ringTint.startsWith('#')
  const tickEls = []

  if (ticks > 0) {
    const cx = size / 2
    const cy = size / 2
    const outer = r - stroke / 2 - 9
    for (let i = 0; i < ticks; i += 1) {
      const major = i % 5 === 0
      const len = major ? 7 : 3.5
      const a = (i / ticks) * 2 * Math.PI
      const sin = Math.sin(a)
      const cos = Math.cos(a)
      tickEls.push(
        <line
          key={i}
          x1={cx + (outer - len) * cos}
          y1={cy + (outer - len) * sin}
          x2={cx + outer * cos}
          y2={cy + outer * sin}
          stroke={tickColor}
          strokeWidth={major ? 1.5 : 1}
          strokeLinecap="round"
          opacity={major ? 0.32 : 0.15}
        />,
      )
    }
  }

  const dotEl = (() => {
    if (!dot || p <= 0.002 || p >= 0.999) return null
    const ang = (-90 + p * 360) * Math.PI / 180
    const dx = size / 2 + r * Math.cos(ang)
    const dy = size / 2 + r * Math.sin(ang)
    const d = stroke + 5
    return (
      <div
        style={{
          position: 'absolute',
          left: dx,
          top: dy,
          width: d,
          height: d,
          marginLeft: -d / 2,
          marginTop: -d / 2,
          borderRadius: '50%',
          background: ringTint,
          boxShadow: isHex ? `0 0 0 5px ${ringTint}1f, 0 2px 8px ${ringTint}55` : undefined,
          transition: 'left .9s linear, top .9s linear',
        }}
      />
    )
  })()

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block', overflow: 'visible' }}>
        {tickEls}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringTint}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{ transition: 'stroke-dashoffset .9s linear' }}
        />
      </svg>
      {dotEl}
      <div className="sesh-ring-content">{children}</div>
    </div>
  )
}

export function Btn({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  icon,
  full,
  disabled,
  style,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'accent' | 'soft' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  full?: boolean
  disabled?: boolean
  style?: CSSProperties
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`sesh-btn sesh-btn-${variant} sesh-btn-${size} ${full ? 'sesh-btn-full' : ''} ${className}`}
      style={style}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 17 : 19} />}
      {children}
    </button>
  )
}

export function Chip({
  children,
  active,
  onClick,
  color,
  style,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  color?: string
  style?: CSSProperties
}) {
  const c = color || 'var(--accent)'
  return (
    <button
      type="button"
      onClick={onClick}
      className="sesh-chip"
      data-active={active ? 'true' : 'false'}
      style={{
        background: active ? (color ? tint(color, 16) : 'var(--accent-soft)') : 'var(--surface-2)',
        color: active ? (color || 'var(--accent-ink)') : 'var(--ink-2)',
        boxShadow: active ? `inset 0 0 0 1.5px ${c}` : undefined,
        ...style,
      }}
    >
      {color && <span className="sesh-chip-dot" style={{ background: c }} />}
      {children}
    </button>
  )
}

export function CatBadge({ category, size = 'md' }: { category?: Pick<CategoryRecord, 'label' | 'color'> | null; size?: 'sm' | 'md' }) {
  if (!category) return null
  const sm = size === 'sm'
  return (
    <span
      className="sesh-cat-badge"
      style={{
        fontSize: sm ? 11.5 : 12,
        padding: sm ? '3px 9px' : '4px 11px',
        background: tint(category.color, 15),
        color: category.color,
      }}
    >
      <span style={{ background: category.color }} />
      {category.label}
    </span>
  )
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<T | { value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="sesh-seg">
      {options.map(option => {
        const v = typeof option === 'string' ? option : option.value
        const label = typeof option === 'string' ? option : option.label
        return (
          <button key={v} type="button" onClick={() => onChange(v)} data-active={v === value ? 'true' : 'false'}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function Sheet({
  open,
  onClose,
  children,
  title,
  height = 'auto',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  height?: CSSProperties['height']
}) {
  if (!open) return null
  return (
    <div className="sesh-sheet-root">
      <button className="sesh-sheet-backdrop" aria-label="Close sheet" onClick={onClose} />
      <div className="sesh-sheet" style={{ height }}>
        <div className="sesh-sheet-grabber" />
        {title && <div className="sesh-sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="sesh-toggle"
      data-on={on ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      aria-pressed={on}
    >
      <span />
    </button>
  )
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 90,
  step = 1,
  unit = 'min',
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  return (
    <div className="sesh-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>-</button>
      <span>{value} {unit}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>+</button>
    </div>
  )
}

export function ScreenHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="sesh-screen-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sesh-group">
      <div className="sesh-group-label">{label}</div>
      <div className="sesh-group-body">{children}</div>
    </div>
  )
}

export function Row({
  icon,
  title,
  sub,
  right,
  onClick,
  last,
}: {
  icon?: IconName
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  onClick?: () => void
  last?: boolean
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick} className="sesh-row" data-last={last ? 'true' : 'false'}>
      {icon && <span className="sesh-row-icon"><Icon name={icon} size={18} color="var(--accent-ink)" /></span>}
      <span className="sesh-row-main">
        <span className="sesh-row-title">{title}</span>
        {sub && <span className="sesh-row-sub">{sub}</span>}
      </span>
      {right && <span className="sesh-row-right">{right}</span>}
    </Comp>
  )
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <div className="sesh-wordmark">
      <span style={{ width: size, height: size, borderRadius: size * 0.32 }}>
        <span />
      </span>
      <strong style={{ fontSize: size * 0.95 }}>sesh</strong>
    </div>
  )
}
