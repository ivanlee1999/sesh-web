'use client'

import { useState } from 'react'
import { MdIcon } from './md/icons'

/**
 * Three full-bleed pages, reachable again from Settings → Replay intro.
 *
 * No illustrations: the system's emphasis is type and one accent, and a
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
        alignItems: 'center',
        padding: phone ? 'calc(var(--safe-t) + 44px) 22px calc(var(--safe-b) + 30px)' : '48px 40px 40px',
      }}
    >
      <div style={{ width: '100%', maxWidth: phone ? 'none' : 520, flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {PAGES.map((item, i) => (
          <span
            key={item.title}
            style={{
              display: 'block',
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= step ? 'var(--accent-base)' : 'var(--fill-3)',
              transition: 'background 260ms',
            }}
          />
        ))}
      </div>

      {/* Keyed on the step so the copy cross-fades rather than swapping. */}
      <div key={step} className="md-poster" style={{ display: 'contents' }}>
        <h2
          className="md-title"
          style={{ margin: '28px 0 0', fontSize: phone ? 28 : 36, letterSpacing: '-.025em', lineHeight: 1.1, textWrap: 'pretty' }}
        >
          {page.title}
        </h2>
        <p
          style={{
            margin: '14px 0 0',
            fontSize: 16,
            lineHeight: 1.55,
            maxWidth: '40ch',
            color: 'var(--color-text-2)',
            textWrap: 'pretty',
          }}
        >
          {page.body}
        </p>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-quiet btn-lg"
          onClick={onDone}
        >
          Skip
        </button>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={() => (last ? onDone() : setStep(step + 1))}
          style={{ flex: 1, minHeight: 52, justifyContent: 'space-between', fontSize: 16 }}
        >
          {last ? 'Start focusing' : 'Next'}
          <MdIcon name="arrow" size={20} strokeWidth={2} color="var(--accent-on)" />
        </button>
      </div>
      </div>
    </div>
  )
}
