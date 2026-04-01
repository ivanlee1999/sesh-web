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

## Animations & Transitions (iOS Native + Things 3)

### Core Principle
iOS uses spring-based animations with slight overshoot. Things 3 adds tactile micro-interactions.
Use CSS `cubic-bezier(0.25, 0.46, 0.45, 0.94)` for standard ease or `cubic-bezier(0.34, 1.56, 0.64, 1)` for spring/bounce.

### Tab Switching
- Active tab icon+label: color transition 200ms ease
- Content area: NO slide animation (instant swap, like iOS tab bar)

### Timer Ring
- Progress arc: `stroke-dashoffset` transition 500ms ease-out (smooth sweep)
- Wedge fill: opacity transition 300ms ease
- Ring scale on START: brief `transform: scale(1.02)` then back, 300ms spring
- Overflow pulse: subtle scale 1.0→1.02→1.0 pulse every 2s on the overflow time text

### Buttons
- Tap: scale(0.97) on active, 100ms — Things 3 "press in" feel
- Release: spring back to scale(1), 200ms with slight overshoot
- START button: add `active:scale-[0.97]` and `transition-transform duration-150`
- Ghost buttons: opacity 0.7 on active

### Chips (Category selection)
- Selection change: background-color transition 200ms ease
- Selected chip: subtle scale spring 1.0→1.05→1.0 on select (200ms)

### List Items
- Delete: fade out + slide left, 200ms ease
- Appear: no animation (instant, like iOS)
- Tap highlight: brief bg opacity flash (iOS tap feedback)

### Cards
- First load: fade-in from opacity 0→1, 200ms ease, staggered 50ms per card
- No slide/bounce on load — keep it subtle

### Todoist Dropdown
- Open: max-height transition 250ms ease + opacity 0→1
- Close: reverse, 200ms

### Toggle Switches
- Konsta Toggle handles this natively — don't override

### Settings Number Stepper
- Number change: brief scale pulse on the number (1.0→1.1→1.0, 150ms)

### Things 3 Specific Touches
- Circular checkbox completion: fill animation from center outward, 300ms
- Swipe-to-delete: smooth translate-x tracking with spring snapback
- Button press: that satisfying "sink in" (scale 0.97) + release spring
- Content transitions feel physical — slight momentum, no teleporting

### CSS Classes to Add in globals.css
```css
/* iOS spring transition */
.ios-spring { transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1); }

/* Press-in effect */
.press-in:active { transform: scale(0.97); }
.press-in { transition: transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94); }

/* Fade in */
.fade-in { animation: fadeIn 200ms ease forwards; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* Overflow pulse */
.overflow-pulse { animation: overflowPulse 2s ease-in-out infinite; }
@keyframes overflowPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
```

### Reduced Motion
Respect `prefers-reduced-motion: reduce` — disable all custom animations.
Already have the media query in globals.css, just ensure new animations use it.
