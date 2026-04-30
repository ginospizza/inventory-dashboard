# Handoff: Gino's Pizza — Inventory & Compliance Dashboard

> **Variation A** — Hero compliance + KPI grid layout. This is the chosen direction.

---

## Overview

A web-based dashboard for Gino's Pizza HQ to monitor weekly ingredient orders against expected usage across ~150 stores. Replaces a manual Excel-and-email workflow run by the finance manager.

**Two roles:**
- **Super Admin** (3 users) — Sees all stores, all brands. Can upload data, manage DSM-store mapping, configure thresholds, use AI chatbot.
- **District Manager (DSM)** (5 users) — Sees only their assigned stores. Read-only dashboards + AI Insights.

**Core question the app answers each week:**  
*Are stores ordering ingredients in proportion to the boxes they're using? If not — who, why, and how bad?*

---

## About the Design Files

The HTML files in this bundle are **design references** — prototypes built to show intended look, layout, and behavior. They are NOT production code to copy directly.

Your job is to **recreate these designs in the project's target codebase** (React + your preferred backend) using established patterns and libraries. If the codebase doesn't exist yet, choose the most appropriate stack — React + TypeScript + a server framework (Next.js, Remix, or a separate API) is the obvious fit given the data model and role-based access requirements.

The data shown in the prototype is synthetic but structurally accurate to the PRD. Real implementation should pull from the uploaded weekly Excel exports, classify products via the App Data lookup table, and run the calculations described in §5 of the PRD.

---

## Fidelity

**High-fidelity (hifi).** Colors, typography, spacing, and interactions are final. Recreate pixel-perfectly.

The single area where you have license to deviate: chart rendering. The prototype uses hand-rolled SVG charts. In production, use a charting library that fits the codebase (Recharts, Visx, Chart.js, ECharts) — match the visual style (dashed target bands, basil-green compliance regions, Gino's red lines, JetBrains Mono axis labels) but you don't need to reimplement the SVG by hand.

---

## Visual Direction

**Warm pizzeria personality, professional execution.** Gino's brand red as the primary accent against a cream/off-white surface palette inspired by pizza dough and parchment. Editorial serif headlines (Instrument Serif) paired with Inter for UI and JetBrains Mono for data. Traffic-light compliance status uses basil green / mustard amber / Gino's red — colors that feel native to the brand world rather than generic dashboard signals.

A subtle red-on-cream checker pattern shows up on the hero compliance card as a brand moment. Use it sparingly — it's flavor, not wallpaper.

---

## Design Tokens

### Colors

```css
/* Brand */
--ginos-red:        #E2231A;   /* primary brand, critical status */
--ginos-red-deep:   #B81812;   /* hover/active states */
--ginos-red-soft:   #FCEAE9;   /* tinted background for red pills */

/* Compliance status */
--basil:            #2E7D4F;   /* in-compliance / good */
--basil-soft:       #E6F1EA;
--mustard:          #C77A00;   /* borderline / warning */
--mustard-soft:     #FBEFD9;

/* Surfaces */
--paper:            #FBF8F2;   /* page background */
--card:             #FFFFFF;   /* card surface */
--crust:            #F4ECDD;   /* warm cream — sub-surface, segmented control bg */
--crust-deep:       #E9DDC2;
--line:             #E7DFCE;   /* primary divider */
--line-2:           #D6CDB7;   /* heavier divider, dashed lines */

/* Text */
--ink:              #1B1A17;   /* primary */
--ink-2:            #4A4843;   /* secondary */
--ink-3:            #7A7670;   /* tertiary / labels */

/* Brand swatches (used in store row accent + brand chart) */
GINOS:  #E2231A
TTD:    #0E5FAE
PP:     #7A2A2A
STORE:  #3D6644
DD:     #9C5B14
```

### Typography

```
Display / headlines:    Instrument Serif, 400 weight
                        Letter-spacing: -0.015em
                        Used for: page H1s (38px), KPI values (28-44px), AI insight headlines (22px), big numbers

UI / body:              Inter, 400/500/600/700
                        Font features: 'ss01', 'cv11'
                        Body: 13px / 1.5
                        Labels: 11px uppercase, .06em tracking, 600 weight
                        Buttons: 13px, 500 weight

Data / numerics:        JetBrains Mono, 400/500
                        Font feature: 'tnum' (tabular nums)
                        Used for: all numbers in tables, ratios, deltas, axis labels

CSS classes provided:   .serif  .mono  .tnum
```

### Spacing & radius

```
Card radius:        14px (--radius-lg)
Control radius:     8-10px
Pill radius:        999px
Page padding:       24px 28px
Card body padding:  16px 18px
Card header:        14px 18px
Grid gaps:          14px (default), 18-20px (large)
```

### Shadows

```
--shadow-sm:  0 1px 0 rgba(27,26,23,.04), 0 1px 2px rgba(27,26,23,.04)
--shadow-md:  0 1px 0 rgba(27,26,23,.04), 0 6px 18px rgba(27,26,23,.06)
--shadow-lg:  0 1px 0 rgba(27,26,23,.04), 0 16px 40px rgba(27,26,23,.10)
```

---

## Screens

### 1. Overview Dashboard (`/overview`) — **VARIATION A**

**Purpose:** Network-level health check at a glance. First screen on login.

**Layout (two-column 1.1fr 2fr top, then 2fr 1.1fr middle, then 1.05fr 1.6fr bottom):**

**Top — Hero compliance card + KPI grid:**
- Left: Hero compliance card (white bg with subtle red checker pattern overlay at 50% opacity). Contains:
  - Eyebrow label `WEEK 15 · NETWORK COMPLIANCE`
  - 132px donut chart, 14px stroke, Gino's red on cream track. Center shows large serif `78%` with `Compliant` sub-label.
  - To right of donut: stacked status bar (basil/mustard/red horizontal bar) with three counts below (`118 in compliance` / `15 borderline` / `18 at risk`)
  - Bottom row separated by dashed border: Sauce:Cheese in band %, Flour:Cheese in band %, stores reporting count
- Right: 3×2 KPI grid. Each KPI card: uppercase label, large serif value (38px), small delta sub-label, tiny sparkline absolutely positioned bottom-right. KPIs:
  1. Avg Cheese Diff (cases) — red sparkline
  2. Avg Sauce Diff (cases) — mustard sparkline
  3. Avg Flour Diff (bags) — basil sparkline
  4. Avg Sauce:Cheese (target 75–125%)
  5. Avg Flour:Cheese (target 75–125%)
  6. Active Flags (with flag icon)

**Middle — Trend + Brand mix:**
- Left: Compliance trend line chart (last 8 weeks, basil-green target band 75–100%, red line, 240px tall)
- Right: Brand breakdown card. For each brand: name + count + compliance %, with a horizontal progress bar tinted in brand color.

**Bottom — AI + At-risk:**
- Left: AI Insights card. Pre-trigger: dark badge `AI INSIGHTS`, headline question, body copy, primary `Generate insight` button. Post-trigger: serif headline + bulleted list with red dot bullets. Includes loading skeleton (shimmer animation) during 1.3s simulated call.
- Right: "Stores requiring attention" table — top 8 worst, sortable by severity. Columns: Store, DSM, Cheese Δ, Sauce Δ, Flour Δ, S:C, F:C, Status pill. Click row → drilldown.

**Page chrome:**
- Page header: "Overview" (38px serif H1) + sub-line, with "Export" + "AI Insights" actions on the right.
- Filter bar (white card, sticky-ish): Week dropdown · Brand dropdown · DSM dropdown (admin only) · pushed-right search & extras.

### 2. All Stores (`/stores`)

Sortable, filterable table of all visible stores (DSMs see only theirs).

**Filters:** Week, Brand, DSM, plus a segmented status filter (All / At risk / Borderline / Compliant) with counts, plus search by code or city.

**Table columns:**
- Store (4px brand-color accent bar + code + city)
- DSM (name + region)
- Cheese Δ, Sauce Δ, Flour Δ — colored mono numbers with unit suffix
- S:C Ratio, F:C Ratio — colored % values
- Flags — small red pills like `cheese ↑`, `sauce ↓`, `+2` overflow
- Status — full pill (In compliance / Borderline / Out of compliance)
- Click chevron → drilldown

Header cells are clickable to sort; show chevron-up/down on the active sort column.

### 3. Store Drilldown (`/store/:id`)

**Header:** breadcrumb back to All Stores · brand label · 6px brand-color stripe · serif H1 with code and city · DSM/region/week sub · status pill inline.

**KPI strip (5 cards):** Cheese / Sauce / Flour / Sauce:Cheese / Flour:Cheese
- Ingredient cards: small icon chip (cream bg, dark-red icon) + label + ordered value + estimated sub-line + diff cell on the right.
- Ratio cards: large value colored by status, custom range visualization showing the 75–125% basil band with a colored marker for current position. Scale below: `0% · 75% · 125% · 200%`.

**Tabs:** Primary Products / Secondary Products / Trends / Flag History (with count)

- **Primary** — last 5 weeks table with all 11 columns from PRD §6.4 (ordered, estimated, diffs, ratios for each ingredient).
- **Secondary** — list of secondary SKUs with last-week qty, 4-week sparkline, and Δ vs 4-week avg.
- **Trends** — 2×2 of LineCharts: S:C ratio, F:C ratio, Cheese ordered vs. estimated (two-series), Cheese diff bars colored by severity.
- **Flag History** — vertical timeline. Each row: large serif "W12" / "2026" eyebrow, then horizontal flag pills with flag icon. Empty state: green "Clean record" message.

### 4. Data Upload (`/upload`) — Super Admin only

Two-column. Left = upload flow, right = last upload + recent uploads.

**Upload flow has 4 stages:**
1. **Idle** — dashed drop zone, red icon chip, serif heading "Drop this week's order export here", file format hints, primary "Choose file" button.
2. **Preview** — file metadata + 4 stat cards (Total / Primary / Secondary / Unclassified, color-coded). Sample rows table showing classification result per row. Cancel + "Confirm & process" actions.
3. **Uploading** — centered card, serif "Processing W16 orders…", red gradient progress bar, mono percentage + row count.
4. **Done** — basil-green check icon, serif "Week 16 is live.", summary line, "Upload another" + "Open W16 dashboard" actions.

### 5. Admin Panel (`/admin`) — Super Admin only

Tabs: DSM ↔ Stores · Product Classification · Thresholds & Assumptions · Login Activity · AI Usage

- **DSM ↔ Stores** — 5 cards (one per DSM) with avatar circle, name, region, store count, scrollable assigned stores list, Add/Reassign actions.
- **Products** — table of all known SKUs with code, description, category pill, pack size, classification pill (Primary green / Secondary neutral / Unclassified mustard). Unclassified rows have mustard-tinted background and a "Classify" button.
- **Thresholds** — left: 5 threshold ranges with label, value, and a small visualization of the band on a 0–200% scale. Right: per-pizza usage assumptions table.
- **Login Activity** — user list with avatar (admin = ink, DSM = red), role pill, last-login timestamp, store count, "● now" pill for active users.
- **AI Usage** — left: large serif "47 of 200 calls" with progress bar. Right: recent AI call log table.

---

## Shared Components

### Sidebar (232px fixed)
Dark gradient background `linear-gradient(180deg, #1B1A17 0%, #2A211A 100%)`, cream text `#F4ECDD`. White-rounded logo chip with red shadow glow. Nav sections labeled in mustard `#8A7C5F`. Active item has Gino's red bg + white text + red glow shadow. Bottom: avatar circle (red, white initials) + name/role + logout icon.

### Topbar (sticky, paper bg, line bottom border)
- Left: breadcrumb (tertiary text → ink bold for current page)
- Right: Role segmented control (Super Admin / DSM — for demo), search pill, bell icon button with red dot badge.

### Status pills (`.pill`)
Pill shape, 11.5px font, 600 weight, with leading colored dot.
- `.pill-ok` basil text on basil-soft bg
- `.pill-warn` mustard text on mustard-soft bg
- `.pill-bad` red text on red-soft bg
- `.pill-neutral` ink-2 on crust bg

### DiffCell
Mono number, colored by `Math.abs(value)` against `±6 / ±9` thresholds (ok/warn/bad). Sign prefix, unit suffix in muted ink-3 (`+8 cs`, `-3 bg`).

### RatioCell
Mono percent. Colored by 75–125 / 65–135 / outside thresholds.

### Donut, Sparkline, LineChart, BarChart, StatusBar
See `src/charts.jsx` for reference. In production use a charting library — match the look (dashed target bands, white-fill data points with colored stroke, 10.5px JetBrains Mono axis labels in `#7A7670`).

---

## Interactions & Behavior

- **Role switch in topbar** filters all data to Brijesh's GTA West stores (DSM mode) or shows everything (Admin). Admin-only nav items hide in DSM mode.
- **Filter bar** (Week / Brand / DSM) on Overview + All Stores — global filters that recompute network stats, trends, and at-risk lists.
- **Click any row** in at-risk list or All Stores table → store drilldown.
- **AI Insights button** opens an inline AI panel with a 1.1–1.3s loading shimmer, then shows a generated headline + bullets. "Regenerate" reruns. Can be dismissed.
- **Upload flow** is a real state machine — idle → preview → uploading (animated progress) → done.
- **Sortable table columns** — click header cell to toggle asc/desc, chevron indicates active sort.
- **Hover** on rows applies `rgba(244,236,221,.4)` (warm cream tint).
- **Animation** — page transitions use a 280ms `fadeUp` keyframe (8px offset → 0).

---

## State Management

Top-level state (in App):
- `page`: 'overview' | 'stores' | 'store' | 'upload' | 'admin'
- `storeId`: string | null
- `role`: 'admin' | 'dsm'
- `brand`: brand id or 'all'
- `dsm`: dsm id or 'all'
- `week`: number

Per-page local state for sort, search, status filter, AI panel open/loading/text, upload stage/progress, active tab.

In production, lift filters into URL params so the dashboard is shareable. Persist role/identity from auth, not local state.

---

## Data Model

See PRD §4 for the canonical schema. Key entities:

- **Store**: `{ code, brand, name, loc, dsm }` — brand derived from code prefix
- **DSM**: `{ id, name, region }`
- **Brand**: `{ id, name, color, count }`
- **WeeklyMetric**: `{ store, week, cheeseOrdered, cheeseEstimated, cheeseDiff, sauceOrdered, sauceEstimated, sauceDiff, flourOrdered, flourEstimated, flourDiff, sauceCheeseRatio, flourCheeseRatio }`
- **Product**: `{ code, name, cat ('Cheese'|'Sauce'|'Flour'|'Box'|'Wing Box'|'Topping'|...), size, weight, classification ('primary'|'secondary'|'neither') }`

Calculations are exactly as specified in PRD §5. The status of a store-week is derived: if any of (S:C, F:C, cheese diff, sauce diff, flour diff) is `bad` → store is `bad`; else if any is `warn` → `warn`; else `ok`.

---

## Assets

- `assets/ginos-logo.jpeg` — Gino's Pizza logo, used in sidebar header. Replace with SVG version if available.

---

## Files in this bundle

- `Gino's Inventory.html` — entry HTML, all CSS tokens, font imports
- `src/data.jsx` — synthetic data + calculation helpers (`ratioStatus`, `diffStatus`, `storeStatus`, `activeFlags`, `networkStats`, `weeklyTrend`)
- `src/icons.jsx` — `<Icon name="..." />` SVG library
- `src/charts.jsx` — `Sparkline`, `LineChart`, `BarChart`, `Donut`, `StatusBar`
- `src/shell.jsx` — Sidebar, Topbar, FilterBar, StatusPill, DiffCell, RatioCell
- `src/page-overview.jsx` — Variation A is the function `LayoutA` in this file. Variations B and C exist but **are not the chosen direction** — ignore them.
- `src/page-stores.jsx` — All Stores table
- `src/page-store.jsx` — Drilldown with tabs
- `src/page-admin.jsx` — Upload flow + Admin panel
- `src/app.jsx` — Root, navigation, role state

---

## Recommended prompt to give your developer / Claude Code

> I'm building the Gino's Pizza Inventory & Compliance Dashboard described in the attached PRD. I've prototyped the design in HTML — the bundled files in `design_handoff_ginos_inventory/` are the visual reference, with **Variation A** of the Overview Dashboard chosen as the final direction.
>
> Please read `README.md` first, then scan the HTML/JSX files to understand the visual system. Recreate the design pixel-perfectly in [your stack — e.g. Next.js + TypeScript + Tailwind + shadcn/ui]. Wire up the real data model from PRD §4, the calculations from §5, and the role-based access from §3 + §7.
>
> Keep the design tokens (colors, type, spacing) exactly as specified in the README. Use a charting library that fits the codebase but match the visual style of the SVG charts in `src/charts.jsx` (dashed target bands, basil-green compliance regions, JetBrains Mono axis labels).
>
> Start by scaffolding the routes (Overview, All Stores, Store Drilldown, Upload, Admin) and the shell (Sidebar + Topbar). Stub data first, then wire up Excel upload and parsing. Save AI features for last.
