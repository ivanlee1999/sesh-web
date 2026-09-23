'use client'

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { MdIcon } from './icons'
import { joinIntention, splitIntention, suggestIntentionItems, type RankedItem } from '@/lib/intention-items'

/**
 * The intention as a list you type into: Enter files what you typed as an
 * item and leaves the field open for the next, and past items are offered as
 * you go. The parent only ever sees one string — the items joined the way
 * picking several tasks joins them — with whatever is half-typed included, so
 * starting a session never loses a word that was not "entered".
 */
export default function IntentionInput({
  value,
  onChange,
  onCommit,
  onEnterEmpty,
  history,
  placeholder,
  ariaLabel,
  className,
  style,
  inputStyle,
  chipFontSize = 15,
  inputClassName,
}: {
  value: string
  onChange: (next: string) => void
  /** Focus has left the whole control — the moment a plain field would blur. */
  onCommit?: (next: string) => void
  /** Enter with nothing typed and nothing highlighted. */
  onEnterEmpty?: () => void
  history: readonly RankedItem[]
  placeholder: string
  ariaLabel: string
  className?: string
  style?: CSSProperties
  inputStyle?: CSSProperties
  chipFontSize?: number
  inputClassName?: string
}) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState(() => splitIntention(value))
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  // The last string handed up. A `value` that differs came from elsewhere —
  // a picked task, a restored session — and replaces what is on screen.
  const emittedRef = useRef(value)

  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    setItems(splitIntention(value))
    setDraft('')
  }, [value])

  const emit = (nextItems: string[], nextDraft: string) => {
    const next = joinIntention([...nextItems, nextDraft])
    if (next === emittedRef.current) return
    emittedRef.current = next
    onChange(next)
  }

  const suggestions = useMemo(
    () => suggestIntentionItems(history, draft, items),
    [history, draft, items],
  )
  const open = focused && !dismissed && suggestions.length > 0

  useEffect(() => { setHighlight(-1) }, [draft, suggestions.length])

  /** File `text` as one or more items (a pasted `A · B` becomes two). */
  const add = (text: string) => {
    const known = new Set(items.map(item => item.toLowerCase()))
    const fresh = splitIntention(text).filter(item => {
      const key = item.toLowerCase()
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    const nextItems = [...items, ...fresh]
    setItems(nextItems)
    setDraft('')
    setDismissed(false)
    emit(nextItems, '')
  }

  const remove = (index: number) => {
    const nextItems = items.filter((_, i) => i !== index)
    setItems(nextItems)
    emit(nextItems, draft)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      event.preventDefault()
      setDismissed(false)
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Cycle through the options and back to "none", which is the field itself.
      const slots = suggestions.length + 1
      setHighlight(prev => ((prev + 1 + step + slots) % slots) - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open && highlight >= 0) add(suggestions[highlight])
      else if (draft.trim()) add(draft)
      else onEnterEmpty?.()
      return
    }
    if (event.key === 'Tab' && open && highlight >= 0) {
      event.preventDefault()
      add(suggestions[highlight])
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setDismissed(true)
      return
    }
    if (event.key === 'Backspace' && draft === '' && items.length > 0) {
      // Take the last item back into the field to edit, rather than deleting
      // it outright — the joined value is unchanged until you type.
      event.preventDefault()
      setDraft(items[items.length - 1])
      setItems(items.slice(0, -1))
    }
  }

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, cursor: 'text', ...style }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          event.preventDefault()
          inputRef.current?.focus()
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (wrapRef.current?.contains(event.relatedTarget as Node | null)) return
        setFocused(false)
        setDismissed(false)
        // Whatever was left half-typed becomes an item, so the screen shows
        // exactly what was filed.
        if (draft.trim()) {
          const nextItems = [...items, ...splitIntention(draft)]
          setItems(nextItems)
          setDraft('')
        }
        onCommit?.(emittedRef.current)
      }}
    >
      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            maxWidth: '100%',
            padding: '3px 3px 3px 10px',
            borderRadius: 'var(--r-sm)',
            background: 'color-mix(in srgb, currentColor 9%, transparent)',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: chipFontSize,
            letterSpacing: '-.01em',
            lineHeight: 1.25,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
          <button
            type="button"
            aria-label={`Remove ${item} from the intention`}
            onClick={() => remove(index)}
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 24,
              height: 24,
              flex: 'none',
              border: 0,
              borderRadius: 'var(--r-sm)',
              background: 'transparent',
              color: 'inherit',
              opacity: .6,
              cursor: 'pointer',
            }}
          >
            <MdIcon name="close" size={14} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={event => {
          setDraft(event.target.value)
          setDismissed(false)
          emit(items, event.target.value)
        }}
        onKeyDown={onKeyDown}
        placeholder={items.length > 0 ? 'Add another…' : placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        className={inputClassName}
        style={{
          flex: '1 1 120px',
          minWidth: 120,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          outline: 'none',
          padding: 0,
          ...inputStyle,
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Past intentions"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 40,
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-lift)',
            fontFamily: 'var(--font-body, inherit)',
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: 0,
          }}
        >
          {suggestions.map((text, index) => (
            <li
              key={text}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={event => {
                // Keep focus in the field so the next item can follow.
                event.preventDefault()
                add(text)
              }}
              onMouseEnter={() => setHighlight(index)}
              style={{
                padding: '9px 10px',
                borderRadius: 'var(--r-sm)',
                cursor: 'pointer',
                background: index === highlight ? 'var(--fill-2)' : 'transparent',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
