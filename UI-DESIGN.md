# sesh — UI Design Document

A minimal iOS-style Pomodoro timer PWA. 5 tabs, one purpose: track focused work.

---

## Design System

**Theme:** iOS native (Apple HIG inspired)
**Framework:** Konsta UI (iOS theme) + Tailwind CSS
**Dark mode:** Toggle in Settings. Uses Tailwind `dark:` classes. No CSS variables for colors.
**Typography:** SF Pro / system font stack. Monospace for timers.
**Max width:** 480px centered. Mobile-first.
**Safe areas:** Respect `env(safe-area-inset-*)` for notch/home-bar devices.

### Colors

| Token | Light | Dark |
|-------|-------|------|
| Background | white | #1c1c1e |
| Surface/Card | #f2f2f7 | #2c2c2e |
| Text primary | #000000 | #ffffff |
| Text secondary | #8e8e93 | #8e8e93 |
| Accent (brand) | #007aff (iOS blue) | #0a84ff |
| Success | #34c759 | #30d158 |
| Warning | #ff9500 | #ff9f0a |
| Danger | #ff3b30 | #ff453a |

### Category Colors (user-defined)

Default palette: 12 preset colors. Users pick from swatches.
Category colors appear as: small dots on chips, bars in charts, ring color on timer.
These are the ONLY inline styles allowed (dynamic `backgroundColor`).

---

## App Shell

```
┌─────────────────────────┐
│                         │  ← Safe area top
│      [Active Tab]       │  ← Scrollable content area
│                         │
│                         │
│                         │
├─────────────────────────┤
│ 🕐  📋  📊  🏷️  ⚙️    │  ← Fixed tab bar (frosted glass)
└─────────────────────────┘  ← Safe area bottom
```

**Tab bar:** Fixed bottom. 5 icons + labels. Frosted glass background (backdrop-blur). Active tab = accent blue. Inactive = gray.

Tabs: Timer | History | Analytics | Categories | Settings

---

## Tab 1: Timer

The hero screen. Two states: **Idle** and **Active**.

### Idle State

```
┌─────────────────────────┐
│                       🟢│  ← Sync indicator (top-right)
│                         │
│ [What are you working?] │  ← Intention input (optional)
│                         │
│ ● Dev  ○ Learn  ○ Other │  ← Category chips (horizontal scroll)
│                         │
│ [Focus] [Short] [Long]  │  ← Session type segmented control
│                         │
│        ╭──────╮         │
│       ╱   25   ╲        │  ← Draggable clock ring (260px)
│      │  minutes  │      │     - Tick marks every minute
│       ╲         ╱       │     - Numbers at 5-min intervals
│        ╰──────╯         │     - Drag to adjust 1-60 min
│                         │
│         25:00           │  ← Time display (large, bold)
│      10:30 → 10:55      │  ← Time range chip
│                         │
│   ┌─── START SESSION ───┐│  ← Primary button (full width, rounded)
│   └─────────────────────┘│
│                         │
│  📋 Select a task...    │  ← Todoist task picker (if configured)
│     ☐ Review PR #123    │     Collapsible dropdown
│     ☐ Fix login bug     │     Shows today's tasks
│     ☐ Write tests       │     Tap to select, ✓ to complete
└─────────────────────────┘
```

**Todoist task picker:** Only shows if Todoist API is configured. Dropdown with today's tasks. Selected task becomes the session's intention. Can close (complete) tasks with a checkmark button.

### Active State

```
┌─────────────────────────┐
│                         │
│ [Working on PR review ] │  ← Editable intention
│                         │
│    FOCUS  ● Development │  ← Phase label + category chip
│                         │
│        ╭──────╮         │
│       ╱        ╲        │  ← Progress ring (280px, not draggable)
│      │  18:32   │       │     - Shows elapsed as filled arc
│       ╲         ╱       │     - Ring color = category color
│        ╰──────╯         │     - Tick marks visible
│                         │
│   ⏸ Pause    ⏭ Finish  │  ← Control buttons
│                         │
│      🗑 Abandon         │  ← Subtle danger link
└─────────────────────────┘
```

**Overflow state:** When timer hits 0, continues counting UP. Ring stays full. Shows "+2:15" overflow in orange above the main time. Phase label changes to "OVERFLOW".

**Paused state:** Shows ▶ Resume and ⏭ Finish buttons.

### Ring Design

- SVG-based circular timer
- Outer: tick marks (60 minor, 12 major at 5-min intervals)
- Numbers (5, 10, 15... 60) outside the ring
- Inner: filled wedge with radial gradient (category color, 15-45% opacity)
- Arc stroke: solid category color, 10px wide
- Background track: light gray (#cccccc light / #555555 dark)
- Idle: draggable (clock hand + tip dot visible)
- Active: non-draggable (no clock hand)
- Responsive: scales down on smaller viewports

---

## Tab 2: History

Session log, grouped by date.

```
┌─────────────────────────┐
│                         │
│ Monday, March 31        │  ← Date header (bold, uppercase-ish)
│ ┌─────────────────────┐ │
│ │ ● PR review    25m  │ │  ← Session row
│ │   10:30  Dev  focus │ │     - Color dot (category)
│ │─────────────────────│ │     - Title = intention or "Untitled"
│ │ ● Bug fix      12m  │ │     - Duration badge (right side)
│ │   11:00  Dev  focus │ │     - Metadata: time, category, type
│ └─────────────────────┘ │     - Swipe or tap trash to delete
│                         │
│ Sunday, March 30        │
│ ┌─────────────────────┐ │
│ │ ● Reading      30m  │ │
│ │   14:00  Learn focus│ │
│ └─────────────────────┘ │
│                         │
│   (empty state:         │
│    "No sessions yet.    │
│     Start your first    │
│     focus session!")     │
└─────────────────────────┘
```

**Layout:** Konsta `List` with `ListGroup` per date. Each session is a `ListItem`.
**Delete:** Trash icon on the right side. Immediate delete (no confirm modal — sessions are lightweight).

---

## Tab 3: Analytics

Dashboard with stats and charts.

```
┌─────────────────────────┐
│                         │
│ ┌──────┐┌──────┐┌─────┐│
│ │ 2h30 ││  6   ││ 5🔥 ││  ← Top stats row (3 cards)
│ │Today ││Sessns││Streak││     - Total focus time today
│ └──────┘└──────┘└─────┘│     - Session count today
│                         │     - Current streak (days)
│ Last 7 Days             │
│ ┌─────────────────────┐ │
│ │ ▐                   │ │  ← 7-day bar chart
│ │ ▐  ▐     ▐         │ │     - One bar per day
│ │ ▐  ▐  ▐  ▐  ▐  ▐  ▐│ │     - Height = total focus ms
│ │ M  T  W  T  F  S  S│ │     - Day labels below
│ └─────────────────────┘ │
│                         │
│ Categories              │
│ ┌─────────────────────┐ │
│ │ ● Dev       65% ███ │ │  ← Category breakdown
│ │ ● Learn     25% ██  │ │     - Color dot + name + percentage
│ │ ● Exercise  10% █   │ │     - Horizontal bar (Tailwind colors)
│ └─────────────────────┘ │
│                         │
│ Today's Timeline        │
│ ┌─────────────────────┐ │
│ │ 9am ██████ 10am     │ │  ← Timeline strip (visual only)
│ │ ████ 11am           │ │     - Blocks = sessions
│ └─────────────────────┘ │     - Color = category
│                         │
└─────────────────────────┘
```

**Top stats:** Three Konsta `Card` components in a grid.
**7-day chart:** Simple bars, no chart library. Pure divs with Tailwind heights.
**Category breakdown:** Horizontal bars with fixed Tailwind color palette (not user-defined colors, to avoid inline styles).
**Timeline:** Horizontal strip showing today's sessions as colored blocks positioned by time.
**Empty state:** "Start tracking to see your stats"

---

## Tab 4: Categories

Manage focus categories.

```
┌─────────────────────────┐
│                         │
│ Categories              │  ← Page title
│                         │
│ ┌─────────────────────┐ │
│ │ [Category name     ]│ │  ← Create form
│ │                     │ │
│ │ 🔵🟣🟪🩷🔴🟠     │ │  ← Color palette grid (6 cols)
│ │ 🟡🟢🟩🩵🔷⚫     │ │     - Selected = black border + ring
│ │                     │ │
│ │ [+ Add Category]    │ │  ← Submit button
│ └─────────────────────┘ │
│                         │
│ ┌─────────────────────┐ │
│ │ ● Development  ✏️ 🗑│ │  ← Category list
│ │───────────────────── │ │     - Color dot + name
│ │ ● Learning     ✏️ 🗑│ │     - Edit + delete buttons
│ │─────────────────────│ │     - "default" chip if isDefault
│ │ ● Exercise     ✏️ 🗑│ │
│ │─────────────────────│ │
│ │ ● Other    default  │ │
│ └─────────────────────┘ │
│                         │
│ (edit mode replaces     │
│  the create form with   │
│  same fields + "Save"   │
│  and "Cancel" buttons)  │
│                         │
│ (delete error: "Cannot  │
│  delete: 5 sessions     │
│  use this category")    │
└─────────────────────────┘
```

**Form:** Shared between create and edit. Text input + color swatch grid.
**List:** Konsta `List` with `ListItem`. Each has media (color dot), title, and after (action buttons).
**Validation:** Name required. Duplicate names prevented.
**Delete protection:** Server returns session count if category is in use.

---

## Tab 5: Settings

```
┌─────────────────────────┐
│                         │
│ Settings                │  ← Page title (large bold)
│                         │
│ TIMER                   │  ← Section title
│ ┌─────────────────────┐ │
│ │ Focus duration       │ │
│ │           [-] 25 [+] │ │  ← Number stepper (minutes)
│ │─────────────────────│ │
│ │ Short break          │ │
│ │            [-] 5 [+] │ │
│ │─────────────────────│ │
│ │ Long break           │ │
│ │           [-] 20 [+] │ │
│ └─────────────────────┘ │
│                         │
│ NOTIFICATIONS           │
│ ┌─────────────────────┐ │
│ │ Sound          [🔘] │ │  ← Toggle switch
│ │─────────────────────│ │
│ │ Push alerts    [🔘] │ │  ← Toggle (with permission flow)
│ │ Granted / Denied     │ │     - Shows permission status
│ └─────────────────────┘ │
│                         │
│ INTEGRATIONS            │
│ ┌─────────────────────┐ │
│ │ Google Calendar      │ │
│ │ 🟢 Connected         │ │  ← Green dot = connected
│ │ Disconnect           │ │     - Red "Disconnect" link
│ │─────────────────────│ │
│ │ Auto-sync sessions   │ │  ← Toggle (only if connected)
│ │                [🔘] │ │
│ └─────────────────────┘ │
│                         │
│ APPEARANCE              │
│ ┌─────────────────────┐ │
│ │ Dark mode      [🔘] │ │  ← Toggle switch
│ └─────────────────────┘ │
│                         │
│ DATA                    │
│ ┌─────────────────────┐ │
│ │ Export sessions      │ │  ← Future feature
│ │ Clear all data       │ │  ← Danger action
│ └─────────────────────┘ │
└─────────────────────────┘
```

**Google Calendar auth:** Device flow (code + URL display). Shows pending state with code box while polling. Connected state with green dot and disconnect link.
**Number stepper:** `-` and `+` buttons flanking a centered number.
**All toggles:** Konsta `Toggle` component.
**Section structure:** `BlockTitle` + `List` (strong, inset).

---

## Shared Patterns

### Loading State
- Centered spinner or "Loading..." text
- Same on all tabs

### Error State
- Red text message
- "Try again" button
- Appears inline, not modal

### Empty State
- Centered message with icon
- Encouraging call-to-action text

### Sync Indicator
- Tiny dot, top-right of Timer tab only
- Green = online + synced
- Orange = offline or out of sync
- Gray = unknown

### Responsive Behavior
- Max 480px centered container
- Ring scales proportionally
- Tab bar stays fixed
- Content scrolls vertically with momentum

---

## Backend Compatibility

The UI MUST use these exact API endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/timer` | GET/PUT | Read/write timer state |
| `/api/sessions` | GET/POST | List/create sessions |
| `/api/sessions/[id]` | DELETE | Delete a session |
| `/api/analytics` | GET | Get stats (todayMs, todayCount, streak, days[]) |
| `/api/categories` | GET/POST | List/create categories |
| `/api/categories/[id]` | PUT/DELETE | Update/delete category |
| `/api/settings` | GET/PUT | Read/write settings |
| `/api/todoist/status` | GET | Check if Todoist is configured |
| `/api/todoist/tasks` | GET | List today's Todoist tasks |
| `/api/todoist/tasks/[id]/close` | POST | Complete a Todoist task |
| `/api/todoist/tasks/[id]/duration` | POST | Update task duration |
| `/api/auth/device` | POST | Start Google device auth flow |
| `/api/auth/device/poll` | POST | Poll device auth status |
| `/api/auth/google/status` | GET | Check Google connection |
| `/api/auth/google/disconnect` | POST | Disconnect Google |
| `/api/push/vapid` | GET | Get VAPID public key |
| `/api/push/subscribe` | POST/DELETE | Manage push subscription |

### Data Shapes (match exactly)

**Timer state:** `{ phase, sessionType, intention, category, targetMs, remainingMs, overflowMs, startedAt, pausedAt, todoistTaskId }`

**Session:** `{ id, intention, category, type, targetMs, actualMs, overflowMs, startedAt, endedAt, notes, todoistTaskId }`

**Category:** `{ id, name, label, color, sortOrder, isDefault }`

**Settings:** `{ focusDuration, shortBreakDuration, longBreakDuration, soundEnabled, calendarSync, darkMode }`

### Context Providers (keep as-is)

- `SettingsProvider` — manages settings state + localStorage + server sync
- `CategoriesProvider` — manages categories with CRUD + caching

These wrap the app and are NOT part of the UI rewrite. Keep them.

---

## Files to Keep (DO NOT DELETE)

- `src/app/api/**` — all API routes
- `src/app/layout.tsx` — root layout
- `src/app/page.tsx` — page entry
- `src/context/**` — providers
- `src/lib/**` — utilities, DB, categories
- `src/types/**` — type definitions
- `public/**` — static assets, manifest, service worker
- `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`
- `data/` — SQLite database

## Files to REWRITE (delete and recreate)

- `src/components/*.tsx` — ALL components
- `src/app/globals.css` — stylesheet (rewrite from scratch, minimal)
