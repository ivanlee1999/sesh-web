# sesh Style Guide — Things 3 + Session + iOS Native

## Color Palette

### Light Mode
| Purpose | Color | Usage |
|---------|-------|-------|
| Background | #FFFFFF | Page background |
| Surface | #F2F2F7 | Card/group backgrounds (iOS system gray 6) |
| Text primary | #000000 | Headings, main text |
| Text secondary | #8E8E93 | Labels, metadata, section titles |
| Text tertiary | #AEAEB2 | Placeholders, hints |
| Accent | #007AFF | Buttons, active states |
| Separator | rgba(60,60,67,0.12) | Hairlines inside groups |
| Card shadow | 0 1px 3px rgba(0,0,0,0.08) | Subtle card elevation |

### Dark Mode
| Purpose | Color |
|---------|-------|
| Background | #000000 (true black, iOS dark) |
| Surface | #1C1C1E |
| Surface elevated | #2C2C2E |
| Accent | #0A84FF |

## Typography

Font stack: -apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif
Timer mono: SF Mono, Geist Mono, Fira Code, Menlo, monospace

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| Page title | 34px | Bold | Large iOS title |
| Timer countdown | 48px | Light (300) | Inside ring, mono |
| Timer overflow | 36px | Light | Orange/warning color |
| Section header | 13px | Semibold | UPPERCASE, 0.06em spacing, gray |
| List item title | 17px | Regular | Primary color |
| Metadata | 13px | Regular | Secondary gray |
| Stat number | 32px | Bold | Large, prominent |
| Stat label | 13px | Regular | Gray below number |
| Button | 17px | Semibold | White on blue fill |
| Chip | 15px | Medium | Pill shaped |

## Key Design Decisions

### Progress Ring (CRITICAL — make it Session-like)
- NO tick marks (remove all 60 ticks)
- NO minute numbers around ring
- NO clock hand
- Clean ring: just track + progress arc + filled wedge
- Track: 8px, #E5E5EA light / #3A3A3C dark
- Arc: 8px, category color, round linecap
- Wedge: radial gradient, 15-35% opacity
- Tip dot: 12px circle at arc end (drag handle in interactive mode)
- Time display INSIDE the ring: 48px mono, light weight
- Ring size: 240px

### Buttons
- START: full-width pill, 50px tall, rounded-full, blue fill
- Action buttons: pill shaped, not rectangles

### Category Chips
- Selected: tinted bg (category color at 10%), small dot + label
- Unselected: gray bg, gray text

### Cards/Groups (Things 3)
- Konsta List strong inset for grouped appearance
- 12px radius
- Surface background color
- Hairline separators, not borders

### Section Titles
- Small, UPPERCASE, letter-spaced, gray — like iOS Settings

## Layout Scale (responsive)

Every size that changes across devices is a CSS custom property on `:root` in
`globals.css`. Components read the token; they never hard-code a breakpoint.
`useCssSize()` (`src/hooks/useCssSize.ts`) bridges these tokens into the SVG
components that need a real number.

| Token | Purpose |
|-------|---------|
| `--shell-max` / `--content-max` | App frame width / centred content width |
| `--gutter` | Horizontal screen padding |
| `--screen-top` / `--screen-bottom-space` | Vertical screen padding |
| `--ring-idle` / `--ring-run` | Dial diameter, idle vs running |
| `--clock-size` | Countdown type size |
| `--control-lg` / `--control-sm` | Transport button diameters |
| `--safe-t/b/l/r` | `env(safe-area-inset-*)`, including landscape notches |

### Breakpoints

| Range | Behaviour |
|-------|-----------|
| `≤359px` wide | Tightened gutters and dial (small phones) |
| `≤660px` tall | Compact scale; scroll hint and large button padding dropped |
| `≤560px` tall + landscape | Dial sits *beside* its controls; single-row category chips |
| `≥600px` wide | Category chips wrap and centre instead of scrolling |
| `≥768px` wide | Tablet scale — wider content column, larger dial |
| `≥1024px` wide | Bottom tab bar becomes a **left rail**; sheets become centred modals |
| `≥1280px` wide | Content column widens to 860px; two-column cards get real room |

Rules of thumb:
- Screens never clip. Where content can outgrow the viewport (the idle timer),
  the container centres with `margin: auto` and scrolls instead of cutting off.
- `.card-grid` gives Insights and Settings a one-column phone layout and a
  two-column tablet/desktop layout; `.card-span-2` opts a card into full width.
- `.split-pane` puts the Calendar month grid beside the day list from 900px up.
- Focus mode is full-bleed on every breakpoint — the rail hides during a session.

---

## Animations & Transitions

### Tokens

```css
--ease-out:    cubic-bezier(0.22, 0.61, 0.36, 1);   /* default */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);   /* overshoot */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);      /* exits */
--dur-1: 120ms;  --dur-2: 200ms;  --dur-3: 320ms;  --dur-4: 460ms;
--stagger: 42ms;
```

### Utilities

| Class | Effect |
|-------|--------|
| `.anim-fade` / `.anim-fade-up` / `.anim-pop` / `.anim-slide-in` | Entrances |
| `.stagger` | Children fade up in sequence (`nth-child` delays) |
| `.stagger-item` | Same, driven by an inline `--i` |
| `.press` / `.press-sm` | Tactile "sink in" on tap, spring back on release |
| `.overflow-pulse` | Overtime countdown pulse |
| `.breathe` | Slow halo expansion behind a running dial |
| `.grow-bar` / `.grow-track` | Charts grow from zero, staggered by `--i` |
| `.skeleton` | Shimmering placeholder while data loads |
| `.anim-number-pop` | Number scale pulse — apply with `key={value}` to replay |

### Where they're used

- **Tab switch** — active panel cross-fades (`fadeSlideIn`); the nav highlight is
  a single pill that *slides* between tabs via `--tab-index`.
- **Segmented control** — same sliding-indicator technique via `--seg-index`.
- **Sheets** — slide up from the bottom on phones, pop in as a centred modal on
  desktop, and animate *out* before unmounting. Portalled to `<body>` so the
  animating tab panel's stacking context can't bury them. Escape closes.
- **Dial** — ticks the arc has passed take on the category colour; the hand
  sweeps on a 0.95s linear transition matched to the tick; a soft halo breathes
  while running; the countdown turns warn-coloured and pulses in overtime.
- **Chips** — spring pop plus a dot scale on selection.
- **Toggles** — the knob stretches on press and springs to its new position.
- **Steppers** — the value pops on every change.
- **Lists** — Tasks, Calendar day cards, Insights cards and Settings groups all
  stagger in; a completing task fills its checkbox and slides out.
- **Reflection** — the check mark draws itself; rating buttons spring.

### Reduced motion

`prefers-reduced-motion: reduce` collapses every animation and transition to
0.01ms. Because entrances use `animation-fill-mode: both`, elements still land
in their final state — nothing disappears.
