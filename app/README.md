# Gino's Pizza — Inventory & Compliance Dashboard

A web-based dashboard for monitoring weekly ingredient orders across 150+ franchise stores. Tracks cheese, sauce, flour/dough compliance by comparing what stores order vs. what they should need based on box orders.

## Status

- **Database**: Supabase (PostgreSQL) — schema deployed, RLS enabled
- **Historical data**: Imported (2024 weeks 47-52, 2025 full year, 2026 weeks 1-15)
- **Auth**: Supabase Auth with email/password login
- **Deployment**: Local dev (Vercel deployment pending)

## Quick Start

```bash
cd app
npm install
cp .env.local.example .env.local   # Fill in Supabase keys
npm run dev                        # http://localhost:3000
```

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=your-openrouter-key           # Optional: AI features
```

### Database Setup

Run `app/supabase/schema.sql` in the Supabase SQL Editor to create all tables, indexes, seed data, and RLS policies.

### Import Historical Data

```bash
cd app
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/import-historical.ts
```

This imports stores, products, and weekly metrics from the Excel files in the project root:
- `Store list and Box Ratios.xlsx` — 160 stores + DSM assignments
- `App Data.xlsx` — 33 primary + 18 secondary products
- `2025 raw data for Gloo.xlsx` — Nov 2024 through Dec 2025 (58 weekly sheets)
- `2026 raw data for Gloo.xlsx` — Jan through Apr 2026 (15 weekly sheets)

## Architecture

```
app/
├── scripts/
│   └── import-historical.ts        # Bulk data import from Excel
├── src/
│   ├── app/
│   │   ├── (auth)/login/           # Login page
│   │   ├── (dashboard)/
│   │   │   ├── overview/           # Network-wide compliance overview
│   │   │   ├── stores/             # All stores table
│   │   │   ├── store/[id]/         # Individual store drilldown
│   │   │   ├── upload/             # Weekly data upload (admin only)
│   │   │   └── admin/              # Admin panel (admin only)
│   │   └── api/
│   │       ├── ai/                 # AI insights endpoint
│   │       ├── metrics/            # Metrics API
│   │       └── upload/             # File upload handler
│   ├── components/
│   │   ├── charts/                 # DonutChart, ComplianceTrend, Sparkline
│   │   ├── dashboard/              # Sidebar, Topbar, FilterBar, StatusPill, DiffCell
│   │   └── ui/                     # shadcn/ui primitives
│   └── lib/
│       ├── calculations/
│       │   ├── engine.ts           # Core compliance calculation engine
│       │   └── constants.ts        # Box ratios, thresholds, conversion factors
│       ├── supabase/
│       │   ├── admin.ts            # Service role client (bypasses RLS)
│       │   ├── auth.ts             # getCurrentUser, requireAdmin
│       │   ├── client.ts           # Browser client
│       │   ├── middleware.ts       # Session refresh + route protection
│       │   └── server.ts           # Server component client (RLS-filtered)
│       ├── data-access.ts          # Server-side data queries
│       ├── excel-parser.ts         # Excel file parser
│       └── types/index.ts          # All TypeScript types
├── supabase/
│   └── schema.sql                  # Full database schema + RLS policies
└── package.json
```

## Key Technical Decisions

### RLS Bypass with Admin Client

The Supabase RLS policies on the `profiles` table cause infinite recursion because admin-check policies on other tables query `profiles`, which triggers `profiles` RLS policies again. **All server-side data queries use `createAdminClient()` (service role key) instead of `createClient()` (anon key).** Auth is enforced at the middleware level and via `getCurrentUser()`.

### Two Calculation Paths

Stores fall into two categories:
- **Flour stores** (GINOS, TTD): Order flour bags, multiply by 1.6 for dough equivalent
- **Dough stores** (DD, WM, STORE): Order pre-portioned dough, use weight directly

See `BUSINESS_RULES.md` for the complete calculation reference.

### Year Mapping for Historical Import

The 2025 Excel file spans Nov 2024 – Dec 2025. Year is determined by **sheet order**, not week number:
- Sheets 0-5 (weeks 47-52) → Year 2024
- Sheets 6-57 (weeks 1-52) → Year 2025

## Data Summary

| Year | Metrics | Weeks | Stores |
|------|---------|-------|--------|
| 2024 | 831 | 47-52 (6) | 168 |
| 2025 | 7,820 | 1-52 (52) | 193 |
| 2026 | 2,231 | 1-15 (15) | 167 |

## Users

| Role | Access |
|------|--------|
| Super Admin (3) | All stores, upload, admin panel, AI |
| DSM (5) | Assigned stores only, dashboards + AI insights |

**DSMs:** Brijesh, Jim, Michel, Paul, Raj

## References

- `BUSINESS_RULES.md` — Source of truth for all calculation logic
- `PRD.md` — Full product requirements document
- `design_handoff_ginos_inventory/` — Design tokens and layout specs
- `Store list and Box Ratios.xlsx` — Store master list + per-pizza ratios
- `App Data.xlsx` — Product catalog (primary + secondary)
