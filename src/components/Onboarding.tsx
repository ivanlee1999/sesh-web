'use client'

import { useState } from 'react'
import { MdIcon } from './md/icons'

/**
 * Three full-bleed pages, reachable again from Settings → Replay intro.
 *
 * No illustrations: the system's emphasis is type and one red rule, and a
 * drawn mock of the dial next to the real one would only ever look like a
 * worse version of it.
 */
const PAGES = [
  {
    title: 'One dial. Everything else gets out of the way.',
    body: 'Drag to set the length, hit start, and sesh holds the clock — even if the tab sleeps or you close the app. The session is logged when it lands.',
  },
  {
    title: 'Your real tasks, not a second to-do list.',
    body: 'Todoist and Things 3 both stream in. Pick one, focus it, and the minutes are written back to the task you actually worked on.',
  },
  {
    title: 'Add to Home Screen for the full-bleed timer.',
    body: 'Installed, sesh runs full screen with notifications, offline queueing and background completion. On the desktop the queue sits beside the dial.',
  },
]

export default function Onboarding({ onDone, phone = true }: { onDone: () => void; phone?: boolean }) {
  const [step, setStep] = useState(0)
  const last = step === PAGES.length - 1
  const page = PAGES[step]

  return (
    <div
      className="md-poster"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        display: 'flex',
        flexDirection: 'column',
        padding: phone ? 'calc(var(--safe-t) + 44px) 20px calc(var(--safe-b) + 30px)' : '34px 34px 30px',
      }}
    >
      <div style={{ display: 'flex', gap: 5 }}>
        {PAGES.map((item, i) => (
          <span
            key={item.title}
            style={{
              display: 'block',
              flex: 1,
              height: 4,
              background: i <= step ? 'var(--color-accent)' : 'var(--color-neutral-300)',
              transition: 'background 260ms',
            }}
          />
        ))}
      </div>

      {/* Keyed on the step so the copy cross-fades rather than swapping. */}
      <div key={step} className="md-poster" style={{ display: 'contents' }}>
        <h2
          className="md-title"
          style={{ margin: '26px 0 0', fontSize: phone ? 30 : 40, letterSpacing: '-.03em', lineHeight: 1.02, textWrap: 'pretty' }}
        >
          {page.title}
        </h2>
        <p
          style={{
            margin: '14px 0 0',
            fontSize: 14.5,
            lineHeight: 1.5,
            maxWidth: '38ch',
            color: 'var(--color-neutral-700)',
            textWrap: 'pretty',
          }}
        >
          {page.body}
        </p>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', gap: 9 }}>
        <button
          type="button"
          className="md-press"
          onClick={onDone}
          style={{
            border: '2px solid var(--color-divider)',
            background: 'transparent',
            color: 'inherit',
            padding: '14px 16px',
            cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: '.09em',
            textTransform: 'uppercase',
          }}
        >
          Skip
        </button>
        <button
          type="button"
          className="md-press"
          onClick={() => (last ? onDone() : setStep(step + 1))}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: 0,
            background: 'var(--color-accent)',
            color: '#fff',
            padding: '14px 16px',
            cursor: 'pointer',
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            textAlign: 'left',
          }}
        >
          {last ? 'Start focusing' : 'Next'}
          <MdIcon name="arrow" size={19} strokeWidth={2.4} color="#fff" style={{ marginLeft: 'auto' }} />
        </button>
      </div>
    </div>
  )
}
