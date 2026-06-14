'use client'

import { useState } from 'react'
import { Btn, Chip, Icon, Ring, Wordmark } from './sesh-ui'

const slides = [
  {
    key: 'focus',
    kicker: 'One thing at a time',
    title: 'State your focus,\nthen begin.',
    body: 'Name a single intention before each session. Clarity first, momentum after.',
    art: (
      <div className="flex flex-col items-center gap-[22px]">
        <div className="flex max-w-[280px] flex-wrap justify-center gap-2">
          <Chip color="#BE6E45" active>Deep Work</Chip>
          <Chip color="#6E86B0">Writing</Chip>
          <Chip color="#7E9476">Study</Chip>
        </div>
        <div className="w-[280px] rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-[22px] py-5 shadow-[var(--shadow-md)]" style={{ borderLeft: '3px solid #BE6E45' }}>
          <div className="mb-2 text-[12px] uppercase tracking-[0.08em] text-[var(--ink-3)]">Intention</div>
          <div className="text-[19px] font-semibold tracking-[-0.02em]">Draft the Q3 strategy memo</div>
        </div>
      </div>
    ),
  },
  {
    key: 'todoist',
    kicker: 'Todoist · Calendar',
    title: 'Your tasks become\nyour sessions.',
    body: 'Pull tasks in from Todoist and focus on them one at a time. Finish a session and the task checks itself off.',
    art: (
      <div className="flex w-[280px] flex-col gap-[10px]">
        {([
          ['Draft the Q3 strategy memo', '#BE6E45', true],
          ['Write the newsletter', '#6E86B0', false],
          ['Study system design', '#7E9476', false],
        ] as const).map(([name, color, active]) => (
          <div key={name} className="flex items-center gap-[13px] rounded-[var(--r-md)] border bg-[var(--surface)] px-[15px] py-[13px]" style={{ borderColor: active ? String(color) : 'var(--line)', borderWidth: active ? 1.5 : 1 }}>
            <span className="h-[18px] w-[18px] flex-shrink-0 rounded-full border-2" style={{ borderColor: String(color) }} />
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-0.01em]">{name}</span>
            {active && (
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
                <Icon name="play" size={14} color={String(color)} />
              </span>
            )}
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'review',
    kicker: 'Every evening',
    title: 'See where your\nhours actually went.',
    body: 'A short reflection after each session becomes a quiet record of your progress over time.',
    art: (
      <div className="flex w-[280px] flex-col gap-4">
        <div className="flex gap-3">
          <Stat big="4" label="day streak" />
          <Stat big="2h 05m" label="today" />
        </div>
        <div className="flex h-[110px] items-end gap-[9px] rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] px-[18px] pb-[14px] pt-[18px]">
          {[40, 70, 30, 90, 55, 80, 60].map((h, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="w-full rounded-[5px]" style={{ height: h, background: i === 3 ? '#BE6E45' : 'var(--surface-2)' }} />
              <span className="text-[10px] text-[var(--ink-3)]">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
]

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="flex-1 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-[14px]">
      <div className="text-[24px] font-bold leading-none tracking-[-0.03em] [font-variant-numeric:tabular-nums]">{big}</div>
      <div className="mt-1 text-[12px] text-[var(--ink-3)]">{label}</div>
    </div>
  )
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0)
  const slide = slides[index]
  const last = index === slides.length - 1

  return (
    <div className="flex h-full flex-col px-[26px] pb-[calc(26px+var(--safe-b))] pt-[calc(58px+var(--safe-t))]">
      <div className="flex items-center justify-between">
        <Wordmark />
        <button type="button" onClick={onDone} className="border-0 bg-transparent text-[15px] font-medium text-[var(--ink-3)]">
          Skip
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        {slide.art}
        <div className="text-center">
          <div className="mb-[14px] text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--accent-ink)]">{slide.kicker}</div>
          <h1 className="m-0 whitespace-pre-line font-[var(--font-display)] text-[30px] font-bold leading-[1.12] tracking-[-0.035em]">{slide.title}</h1>
          <p className="mx-auto mb-0 mt-[14px] max-w-[320px] text-[16px] leading-normal text-[var(--ink-2)]">{slide.body}</p>
        </div>
      </div>

      <div className="flex flex-col gap-[22px]">
        <div className="flex justify-center gap-[7px]">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className="h-[7px] rounded-full border-0 p-0 transition-all"
              style={{ width: i === index ? 22 : 7, background: i === index ? 'var(--accent)' : 'var(--line-strong)' }}
            />
          ))}
        </div>
        <Btn full size="lg" onClick={() => (last ? onDone() : setIndex(index + 1))}>
          {last ? 'Get started' : 'Continue'}
        </Btn>
      </div>
    </div>
  )
}

export function AuthIllustration() {
  return (
    <Ring progress={0.68} size={210} stroke={5}>
      <div className="text-[44px] font-bold leading-none tracking-[-0.04em] [font-variant-numeric:tabular-nums]">17:24</div>
      <div className="mt-1 text-[13px] text-[var(--ink-3)]">focusing</div>
    </Ring>
  )
}
