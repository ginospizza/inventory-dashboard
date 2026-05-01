-- Gino's Pizza — Inventory & Compliance Dashboard
-- Database schema for Supabase (PostgreSQL)
--
-- Run this in the Supabase SQL Editor to create all tables.
-- After creating tables, set up RLS policies below.

-- ── DSMs ─────────────────────────────────────────────────────

create table if not exists dsms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text not null default '',
  created_at timestamptz default now()
);

-- ── Stores ───────────────────────────────────────────────────

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,          -- e.g. "GINOS032", "TTD BLOCKLINE"
  name text not null default '',       -- display name (can differ from code)
  brand text not null default 'OTHER', -- GINOS, TTD, PP, STORE, DD, WM, OTHER
  address text not null default '',
  city text not null default '',
  dsm_id uuid references dsms(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_stores_dsm on stores(dsm_id);
create index if not exists idx_stores_brand on stores(brand);
create index if not exists idx_stores_code on stores(code);

-- ── User profiles ────────────────────────────────────────────
-- Extends Supabase Auth users with app-specific fields.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'dsm' check (role in ('super_admin', 'dsm')),
  dsm_id uuid references dsms(id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_dsm on profiles(dsm_id);

-- ── Products ─────────────────────────────────────────────────

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  type text not null default 'Other',          -- Cheese, Pizza Sauce, Flour, Dough, Packaging, Wing Box, Secondary, Other
  classification text not null default 'neither' check (classification in ('primary', 'secondary', 'neither')),
  pack_size text not null default '',
  weight numeric not null default 0,
  weight_unit text not null default 'each',     -- kg, Fl oz, each
  created_at timestamptz default now()
);

create index if not exists idx_products_code on products(code);
create index if not exists idx_products_classification on products(classification);

-- ── Uploads ──────────────────────────────────────────────────

create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  uploaded_by uuid references profiles(id) on delete set null,
  uploaded_at timestamptz default now(),
  week_number integer,
  year integer,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  rows_processed integer default 0,
  primary_count integer default 0,
  secondary_count integer default 0,
  unclassified_count integer default 0,
  error_message text
);

-- ── Weekly orders (raw parsed data) ──────────────────────────

create table if not exists weekly_orders (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references uploads(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  week_number integer not null,
  year integer not null,
  quantity numeric not null default 0,
  raw_company_name text,         -- original CompanyName from Excel
  raw_product_code text,         -- original productcode from Excel
  raw_description text,          -- original description from Excel
  created_at timestamptz default now()
);

create index if not exists idx_weekly_orders_store_week on weekly_orders(store_id, year, week_number);
create index if not exists idx_weekly_orders_upload on weekly_orders(upload_id);

-- ── Weekly metrics (computed per store-week) ─────────────────

create table if not exists weekly_metrics (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  week_number integer not null,
  year integer not null,

  -- Ordered (standardized units)
  cheese_ordered_oz numeric not null default 0,
  sauce_ordered_floz numeric not null default 0,
  flour_ordered_kg numeric not null default 0,
  dough_ordered_kg numeric not null default 0,

  -- Box counts (individual boxes)
  boxes_small integer not null default 0,
  boxes_medium integer not null default 0,
  boxes_large integer not null default 0,
  boxes_xl integer not null default 0,
  boxes_party integer not null default 0,
  boxes_total integer not null default 0,

  -- Estimated usage
  cheese_estimated_oz numeric not null default 0,
  sauce_estimated_floz numeric not null default 0,
  flour_estimated_kg numeric not null default 0,
  dough_estimated_kg numeric not null default 0,

  -- Differences
  cheese_diff numeric not null default 0,
  sauce_diff numeric not null default 0,
  flour_diff numeric not null default 0,
  dough_diff numeric not null default 0,

  -- Ratios (as decimals, e.g. 0.878 = 87.8%)
  sauce_cheese_ratio numeric not null default 0,
  flour_cheese_ratio numeric not null default 0,
  dough_cheese_ratio numeric not null default 0,

  -- Sales estimates
  total_boxes_ordered integer not null default 0,
  estimated_pizza_sales integer not null default 0,
  weekly_pizza_sales integer not null default 0,

  -- Status
  -- Store type
  store_type text not null default 'flour' check (store_type in ('flour', 'dough')),

  -- Status
  cheese_status text not null default 'ok' check (cheese_status in ('ok', 'warn', 'bad')),
  sauce_status text not null default 'ok' check (sauce_status in ('ok', 'warn', 'bad')),
  flour_status text not null default 'ok' check (flour_status in ('ok', 'warn', 'bad')),
  dough_status text not null default 'ok' check (dough_status in ('ok', 'warn', 'bad')),
  sauce_cheese_status text not null default 'ok' check (sauce_cheese_status in ('ok', 'warn', 'bad')),
  flour_cheese_status text not null default 'ok' check (flour_cheese_status in ('ok', 'warn', 'bad')),
  dough_cheese_status text not null default 'ok' check (dough_cheese_status in ('ok', 'warn', 'bad')),
  overall_status text not null default 'ok' check (overall_status in ('ok', 'warn', 'bad')),

  created_at timestamptz default now(),

  unique(store_id, year, week_number)
);

create index if not exists idx_weekly_metrics_store_week on weekly_metrics(store_id, year, week_number);
create index if not exists idx_weekly_metrics_week on weekly_metrics(year, week_number);
create index if not exists idx_weekly_metrics_status on weekly_metrics(overall_status);

-- ── Usage assumptions ────────────────────────────────────────

create table if not exists usage_assumptions (
  id uuid primary key default gen_random_uuid(),
  pizza_size text not null unique check (pizza_size in ('small', 'medium', 'large', 'xl', 'party')),
  cheese_oz numeric not null,
  sauce_oz numeric not null,
  flour_kg numeric not null,
  boxes_per_case integer not null default 40
);

-- Seed defaults from sample data formulas
insert into usage_assumptions (pizza_size, cheese_oz, sauce_oz, flour_kg, boxes_per_case) values
  ('small',  4,     2.5,   0.3,    40),
  ('medium', 6,     4,     0.45,   40),
  ('large',  8,     5,     0.6,    40),
  ('xl',     10,    6,     0.775,  40),
  ('party',  16,    10,    1.2,    40)
on conflict (pizza_size) do nothing;

-- ── Thresholds ───────────────────────────────────────────────

create table if not exists thresholds (
  id uuid primary key default gen_random_uuid(),
  metric text not null unique,
  warn_value numeric not null,    -- |diff| > warn = borderline
  bad_value numeric not null,     -- |diff| > bad = out of compliance
  -- For ratios: warn_value = warn boundary, bad_value = bad boundary
  type text not null default 'diff' check (type in ('diff', 'ratio'))
);

insert into thresholds (metric, warn_value, bad_value, type) values
  ('cheese_diff',         3,   6,   'diff'),
  ('sauce_diff',          3,   6,   'diff'),
  ('flour_diff',          3,   6,   'diff'),
  ('sauce_cheese_low',    75,  65,  'ratio'),
  ('sauce_cheese_high',   125, 135, 'ratio'),
  ('flour_cheese_low',    75,  65,  'ratio'),
  ('flour_cheese_high',   125, 135, 'ratio')
on conflict (metric) do nothing;

-- ── AI call tracking ─────────────────────────────────────────

create table if not exists ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  called_at timestamptz default now(),
  page_context text not null default '',
  tokens_used integer not null default 0,
  model text not null default ''
);

create index if not exists idx_ai_calls_user on ai_calls(user_id);
create index if not exists idx_ai_calls_date on ai_calls(called_at);

-- ── AI config ────────────────────────────────────────────────

create table if not exists ai_config (
  id uuid primary key default gen_random_uuid(),
  monthly_call_cap integer not null default 200,
  default_model text not null default 'openai/gpt-4o-mini',
  updated_at timestamptz default now()
);

insert into ai_config (monthly_call_cap, default_model) values (200, 'openai/gpt-4o-mini')
on conflict do nothing;

-- ── Row Level Security ───────────────────────────────────────

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table dsms enable row level security;
alter table stores enable row level security;
alter table products enable row level security;
alter table uploads enable row level security;
alter table weekly_orders enable row level security;
alter table weekly_metrics enable row level security;
alter table usage_assumptions enable row level security;
alter table thresholds enable row level security;
alter table ai_calls enable row level security;
alter table ai_config enable row level security;

-- Profiles: users can read their own profile
create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id);

-- Profiles: super admins can read all profiles
create policy "Admins can read all profiles" on profiles
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

-- DSMs: all authenticated users can read
create policy "Authenticated users can read DSMs" on dsms
  for select using (auth.uid() is not null);

-- Stores: super admins see all, DSMs see only their assigned stores
create policy "Admins see all stores" on stores
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "DSMs see assigned stores" on stores
  for select using (
    dsm_id = (select dsm_id from profiles where id = auth.uid())
  );

-- Products: all authenticated users can read
create policy "Authenticated users can read products" on products
  for select using (auth.uid() is not null);

-- Uploads: all authenticated users can read
create policy "Authenticated users can read uploads" on uploads
  for select using (auth.uid() is not null);

-- Admins can insert uploads
create policy "Admins can create uploads" on uploads
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

-- Weekly orders: follow store access rules
create policy "Users see orders for accessible stores" on weekly_orders
  for select using (
    store_id in (select id from stores)  -- RLS on stores will filter
  );

-- Weekly metrics: follow store access rules
create policy "Users see metrics for accessible stores" on weekly_metrics
  for select using (
    store_id in (select id from stores)  -- RLS on stores will filter
  );

-- Usage assumptions, thresholds: all authenticated can read
create policy "Authenticated read assumptions" on usage_assumptions
  for select using (auth.uid() is not null);

create policy "Authenticated read thresholds" on thresholds
  for select using (auth.uid() is not null);

-- Admins can modify assumptions and thresholds
create policy "Admins can modify assumptions" on usage_assumptions
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "Admins can modify thresholds" on thresholds
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

-- AI calls: all authenticated can read, all can insert
create policy "Authenticated read ai_calls" on ai_calls
  for select using (auth.uid() is not null);

create policy "Authenticated insert ai_calls" on ai_calls
  for insert with check (auth.uid() is not null);

-- AI config: all authenticated can read
create policy "Authenticated read ai_config" on ai_config
  for select using (auth.uid() is not null);

-- Admins can modify all data tables
create policy "Admins full access stores" on stores
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "Admins full access products" on products
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "Admins full access weekly_orders" on weekly_orders
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "Admins full access weekly_metrics" on weekly_metrics
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "Admins full access ai_config" on ai_config
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "Admins full access profiles" on profiles
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );
