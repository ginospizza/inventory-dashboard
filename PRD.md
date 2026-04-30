# PRD: Gino's Pizza — Inventory & Compliance Dashboard

## 1. Problem Statement

Gino's Pizza operates ~150+ stores across multiple brands (Ginos, TTD, PP/WM, STORE, DD, others). Each week, the warehouse ships food to every store. Currently, James (finance manager) manually exports order data from the ordering system, builds pivot tables in Excel, converts pack sizes to standardized units (kg, fl oz), calculates compliance ratios, and emails filtered views to each district manager. This process is manual, error-prone, and produces static Excel sheets that aren't mobile-friendly or interactive.

## 2. Solution

A web-based dashboard where:
- James uploads a weekly CSV/Excel export from the ordering system
- The system automatically parses orders, classifies products (primary/secondary/other), converts units, and calculates compliance ratios
- District managers log in and see only their assigned stores
- Super admins see everything with brand-level filtering
- AI insights surface anomalies and summarize store performance on demand

**Core question the app answers each week:**
*Are stores ordering ingredients in proportion to the boxes they're using? If not — who, why, and how bad?*

## 3. Users & Roles

| Role | Count | Access | Capabilities |
|------|-------|--------|-------------|
| **Super Admin** | 3 (Raj, James, +1) | All stores, all brands | Upload data, manage DSM-store mapping, manage product classification, configure ratios/thresholds, view all dashboards, AI chatbot + insights, login tracking |
| **District Manager (DSM)** | 5 (Brijesh: 38 stores, Jim: 9, Michel: 36, Paul: 50, Raj: 37) | Only assigned stores | View dashboards for their stores, AI insights (manual trigger), no upload/config access |

## 4. Tech Stack

| Component | Choice |
|-----------|--------|
| Framework | Next.js 14+ (App Router) + TypeScript |
| Styling | Tailwind CSS + shadcn/ui (with custom Gino's design tokens) |
| Database | Supabase (PostgreSQL) |
| Authentication | Supabase Auth |
| File Storage | Supabase Storage |
| Hosting | Vercel |
| Charts | Recharts |
| Excel Parsing | SheetJS (xlsx) |
| AI | OpenRouter (default model: GPT or Haiku, configurable) |
| Email | Resend (for upload notifications) |

## 5. Data Model

### 5.1 Raw Data Input

**Source:** Weekly Excel export from ordering system
**Format:** Single-tab file (weekly going forward). Historical files may have one tab per week.
**Schema per row:**

| Column | Example | Notes |
|--------|---------|-------|
| CompanyName | `GINOS032` / `TTD BLOCKLINE` | Store identifier |
| WeekNumber | `15` | Week of the year |
| productcode | `20105` / `G040114` | Unique per SKU + pack size |
| description | `3D 20% SHRED CHEESE (4x2.27 Kg)` | Human-readable |
| TotalQty | `24` | Cases/units ordered that week |

### 5.2 Product Classification (from App Data.xlsx)

**Primary Products** (33 SKUs) — deep analysis with unit conversion + ratio calculations:

**Cheese (4 SKUs):**
| Code | Item | Pack Size | Weight (kg) |
|------|------|-----------|-------------|
| 20103 | SAP 20% PMZ IQF 1/8 3D 2x5KG | 2x5KG | 10 |
| 20105 | 3D 20% SHRED CHEESE (4x2.27 Kg) | 4x2.27KG | 9.08 |
| 020102A | French Mozz Cheese - 10kg | 10kg | 10 |
| T020111 | SAG 20% PZMZ EW 3D 10*2.4KG GOLD | 10x2.4kg | 24 |

**Pizza Sauce (2 SKUs):**
| Code | Item | Pack Size | Weight (fl oz) |
|------|------|-----------|----------------|
| G040114 | Ginos Pizza Sauce 6x100 fl.oz | 6x100 floz | 600 |
| 40114 | V Food Premium Pizza Sauce 6x2.84L | 6x2.84L | ~576.2 (6*2.84*33.814) |

**Flour (2 SKUs):**
| Code | Item | Pack Size | Weight (kg) |
|------|------|-----------|-------------|
| G050106 | Ginos Flour (20 Kg) | 20kg | 20 |
| T050106 | V Food Flour (20 Kg) | 20kg | 20 |

**Dough (5 SKUs):**
| Code | Item | Pack Size | Weight (kg) |
|------|------|-----------|-------------|
| 50120 | Small Dough PT (72x300) | 72x300g | 21.6 |
| 50121 | Medium Dough PT (40x410) | 40x410g | 16.4 |
| 50122 | Large Dough PT (36x550) | 36x550g | 19.8 |
| 50123 | X-Large Dough PT (24x800) | 24x800g | 19.2 |
| 50124 | Party Dough PT (20x1000) | 20x1000g | 20 |

**Packaging — Pizza Boxes (14 SKUs across Ginos/TTD/DD brands):**
Small (10"), Medium (12"), Large (14"), XL (16"), Party (20"/15x21") — all 40 per case.

**Packaging — Wing Boxes (4 SKUs):**
8/10/12/14 wing boxes — 50 per case.

**Secondary Products** (18 SKUs) — lightweight tracking, no ratio calculations:
Wings (4), chicken topping (1), hot peppers (1), olives (4), pineapple (1), jalapenos (1), pepperoni (2), bacon (1), ham (1), sausage (2).

**Neither** — everything else. Stored in background, not displayed. Admins can promote to primary/secondary.

### 5.3 Store-to-DSM Mapping

From DSM list: Store → Address → City → DSM
- 171 stores mapped across 5 DSMs
- Managed by super admins in back-end panel
- Used for access control and filtering

### 5.4 Brands

Derived from store name prefix:
- **GINOS** (~85 stores) — primary brand
- **TTD** / Twice the Deal (~31 stores)
- **PP/WM** (~11 stores) — awaiting brand name confirmation
- **STORE** (~13 stores) — awaiting brand name confirmation
- **DD** — referenced in packaging SKUs, awaiting confirmation
- Other one-offs: SAPUTO, SUNDRY, WM

### 5.5 Database Schema (Supabase/PostgreSQL)

```
users
  id, email, role (super_admin | dsm), dsm_id (FK nullable), name, last_login_at

dsms
  id, name, region

stores
  id, code, name, brand, address, city, dsm_id (FK)

products
  id, code, description, type (Cheese|Sauce|Flour|Dough|Packaging|Secondary|Other),
  classification (primary|secondary|neither), pack_size, weight, weight_unit

uploads
  id, filename, uploaded_by (FK), uploaded_at, week_number, year, status, rows_processed

weekly_orders (raw parsed data)
  id, upload_id (FK), store_id (FK), product_id (FK), week_number, year, quantity

weekly_metrics (computed per store-week)
  id, store_id (FK), week_number, year,
  cheese_ordered_oz, cheese_estimated_oz, cheese_diff,
  sauce_ordered_floz, sauce_estimated_floz, sauce_diff,
  flour_ordered_kg, flour_estimated_kg, flour_diff,
  sauce_cheese_ratio, flour_cheese_ratio,
  total_boxes, estimated_pizza_sales, weekly_pizza_sales,
  status (ok|warn|bad)

usage_assumptions
  pizza_size (small|medium|large|xl|party),
  cheese_oz_per_pizza, sauce_oz_per_pizza, flour_kg_per_pizza,
  dough_kg_per_pizza

thresholds
  metric (cheese_diff|sauce_diff|flour_diff|sauce_cheese_ratio|flour_cheese_ratio),
  warn_low, warn_high, bad_low, bad_high

ai_calls
  id, user_id (FK), called_at, page_context, tokens_used
```

## 6. Core Calculations

### 6.1 Primary Product Aggregation (per store, per week)

For each store-week, aggregate all orders by product type:

**Total Cheese Ordered (oz):**
Sum across all cheese SKUs: `qty x weight_kg x 35.27` (kg to oz conversion)

**Total Sauce Ordered (fl oz):**
Sum across all sauce SKUs: `qty x weight_floz`

**Total Flour Ordered (kg):**
Sum across all flour SKUs: `qty x weight_kg`

**Total Boxes Ordered (by size):**
For each pizza size (S/M/L/XL/Party): `qty x 40` (cases to individual boxes)

### 6.2 Estimated Usage (derived from box orders)

Based on pizza size assumptions (from sample data formulas):

**Estimated Cheese Usage (oz):**
`Party*40*16 + XL*40*10 + L*8*40 + M*40*6 + S*40*4 + PaperPlates*1200*2`

**Estimated Sauce Usage (fl oz):**
`XL*40*6 + L*40*5 + M*4*40 + S*40*2.5 + Party*40*10 + PaperPlates*1200*(10/8)`

**Estimated Flour Usage (kg):**
`(Party*1.2*40 + XL*0.775*40 + L*0.6*40 + M*0.45*40 + S*0.3*40 + PaperPlates*1200*0.15) / 1.6`

*(Paper plates and per-pizza-size constants — awaiting confirmation from Gino's on whether these are current and whether admins should be able to edit them.)*

### 6.3 Compliance Ratios

**Cheese Difference (cases):** `(Total Cheese Ordered - Estimated Usage) / divisor`
*(divisor depends on cheese pack size used by store — e.g., 352.7 for 10kg blocks, 35.27*24 for 24kg packs, 35.27*4*2.27 for shredded)*

**Sauce Difference (cases):** `(Total Sauce Ordered - Estimated Usage) / (33.814 x 6 x 2.84)`

**Flour Difference (bags):** `(Total Flour Ordered - Estimated Usage) / 20`

**Sauce-to-Cheese Ratio:** `(Total Sauce / 5) / (Total Cheese / 8)`
- Target: 75%-125% = in compliance

**Flour-to-Cheese Ratio:** `(Total Flour x 1.6 / 0.6) / (Total Cheese / 8)`
- Target: 75%-125% = in compliance

### 6.4 Flagging Logic

| Metric | Condition | Status | Flag Meaning |
|--------|-----------|--------|-------------|
| Cheese diff > 6 | Over-ordering | bad | Over portioning cheese OR buying unapproved boxes |
| Cheese diff < -6 | Under-ordering | bad | Buying unapproved cheese OR under portioning |
| Sauce diff > 6 | Over-ordering | bad | Over portioning sauce OR buying unapproved boxes |
| Sauce diff < -6 | Under-ordering | bad | Unapproved sauce, water in sauce, under portioning |
| Flour diff > 6 | Over-ordering | bad | Dough too heavy OR buying unapproved boxes |
| Flour diff < -6 | Under-ordering | bad | Dough too light OR buying unapproved flour |
| Sauce:Cheese < 75% | Low ratio | bad | Unapproved sauce, water, under portioning sauce |
| Sauce:Cheese > 125% | High ratio | bad | Unapproved cheese, under portioning cheese |
| Flour:Cheese < 75% | Low ratio | bad | Dough too light, unapproved flour |
| Flour:Cheese > 125% | High ratio | bad | Unapproved cheese, under portioning cheese |

**Intermediate thresholds** (borderline/warn):
- Diff: abs(diff) between ~3-6 (TBD, configurable)
- Ratios: 65-75% or 125-135% (TBD, configurable)

**Store status** = worst of all individual metrics. Any `bad` -> store is `bad`. Any `warn` and no `bad` -> `warn`. All `ok` -> `ok`.

## 7. Screens

### 7.1 Login (`/login`)
- Branded split-screen: left = Gino's brand moment, right = credential form
- Email + password via Supabase Auth
- Redirects to Overview on success
- Role determined from user record in DB

### 7.2 Overview Dashboard (`/overview`) — Variation A
**Available to:** All roles (filtered by access)

**Layout:** Two-column grid with hero compliance + KPI grid + trends + AI insights + at-risk table.

See design handoff README for full layout specification.

Key data requirements:
- Network compliance % (stores within all thresholds / total stores)
- Status breakdown (compliant / borderline / at risk counts)
- Avg cheese diff, sauce diff, flour diff, S:C ratio, F:C ratio
- 8-week compliance trend
- Brand breakdown with per-brand compliance %
- Top 8 worst stores table
- AI insights (manual trigger)

**Filters:** Week picker, Brand dropdown, DSM dropdown (admin only)

### 7.3 All Stores (`/stores`)
**Available to:** All roles (DSMs see only their stores)

Sortable, filterable table. See design handoff for column spec.

**Filters:** Week, Brand, DSM, status segmented control (All/At risk/Borderline/Compliant), search by code or city.

### 7.4 Store Drilldown (`/store/:id`)
**Available to:** All roles (DSMs only for their stores; 403 otherwise)

**Tabs:** Primary Products / Secondary Products / Trends / Flag History

- Primary: last 5 weeks table with ordered, estimated, diffs, ratios per ingredient
- Secondary: SKU list with last-week qty, 4-week sparkline, delta vs 4-week avg
- Trends: 2x2 line/bar charts for ratios and diffs
- Flag History: vertical timeline of weekly flags

### 7.5 Data Upload (`/upload`) — Super Admin only
Two-column layout. Upload flow with 4 stages: Idle -> Preview -> Uploading -> Done.

**Upload pipeline:**
1. Parse Excel file (single-tab or multi-tab)
2. Validate columns (CompanyName, WeekNumber, productcode, description, TotalQty)
3. For each row: match product code to classification, convert units
4. Aggregate by store-week: sum ordered quantities by product type
5. Calculate estimated usage from box orders
6. Calculate diffs and ratios
7. Determine status per metric and overall store status
8. Persist to weekly_orders + weekly_metrics tables
9. Send email notification to all DSMs via Resend

**Preview stage** shows: total rows, primary/secondary/unclassified counts, sample rows with classification result.

### 7.6 Admin Panel (`/admin`) — Super Admin only

**Tabs:**
- **DSM <-> Stores**: 5 cards per DSM showing assigned stores, with add/reassign
- **Product Classification**: Table of all known SKUs with classification pill, ability to reclassify
- **Thresholds & Assumptions**: Edit diff thresholds (currently +/-6) and ratio bands (75-125%), edit per-pizza usage assumptions
- **Login Activity**: User list with last login timestamps
- **AI Usage**: Call count vs monthly cap, recent call log

## 8. Role-Based Access (Server-Side Enforced)

| Route | Super Admin | DSM |
|-------|-------------|-----|
| `/login` | Pre-auth | Pre-auth |
| `/overview` | All data | Filtered to assigned stores |
| `/stores` | All stores | Filtered to assigned stores |
| `/store/:id` | Any store | Only assigned stores (403 otherwise) |
| `/upload` | Yes | 403 |
| `/admin` | Yes | 403 |
| API routes | Full access | Filtered by dsm_id |

All API routes validate session role before returning data. DSM filtering happens server-side, not just in UI.

## 9. AI Features

- **AI Insights** (all users, manual trigger): Per-page summary analyzing current data view. Button click triggers OpenRouter API call, shows loading shimmer, then displays headline + bullets. "Regenerate" reruns.
- **AI Chatbot** (admin-only at launch): Natural language queries against the data.
- **Monthly cap**: Hard limit on API calls, configurable in admin panel.
- **Cost model**: Gino's will own their OpenRouter API key. We configure the threshold.
- **Default model**: GPT or Haiku via OpenRouter (configurable in env).

## 10. Notifications

- Email to all DSMs (via Resend) when new weekly data is uploaded.
- Future consideration: threshold-breach alerts.

## 11. Data Volume

- ~151 active stores
- ~3,500-4,000 line items per weekly upload
- ~52 weeks/year -> ~200K raw order rows/year
- Historical: ~75 weeks (2025 + 2026 YTD)
- 33 primary SKUs, 18 secondary SKUs

## 12. Design Reference

See `design_handoff_ginos_inventory/README.md` for:
- Complete design tokens (colors, typography, spacing, shadows)
- Per-screen layout specifications
- Shared component contracts (StatusPill, DiffCell, RatioCell, FilterBar, etc.)
- Interaction patterns and animations

**Chosen direction:** Variation A of the Overview Dashboard.

## 13. Open Questions (Awaiting Gino's Response)

1. Brand names for PP/WM, STORE, DD prefixes
2. Dough inclusion in ratio analysis
3. Wing box treatment in calculations
4. Paper plates — active product or reference only
5. Per-pizza usage assumptions — current? admin-editable?
6. +/-6 threshold — same for all three? configurable?
7. Clean store name master list (raw export names -> DSM mapping)
8. Vick — active DSM or reassigned?
9. Any additional ratios beyond cheese/sauce/flour diffs and S:C / F:C ratios?
