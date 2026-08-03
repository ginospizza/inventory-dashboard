-- Make thresholds & usage assumptions genuinely editable (James, July 31 2026:
-- "Same with the Thresholds and Assumptions, could you add an edit, add and
-- remove function please?").
--
-- WHY A RESHAPE AND NOT JUST AN EDIT UI: both tables exist and are displayed
-- in the admin panel, but the calculation engine has NEVER read them — it uses
-- hardcoded constants (src/lib/calculations/constants.ts). Worse, the seeded
-- values are stale relative to what actually drives the dashboard:
--
--   thresholds        seeded flat case counts (warn 3 / bad 6) from before the
--                     percentage grading shipped, and ratio bands with no
--                     Severe tier — the admin tab has been showing numbers
--                     that do not drive anything
--   usage_assumptions five pizza sizes with a "flour_kg" column, while the
--                     engine uses EIGHT buckets (incl. party 21x15, clamshell,
--                     plate) keyed on DOUGH kg, plus pizza-sales-per-case
--
-- This migration reshapes both tables to the engine's actual shape and reseeds
-- them to EXACTLY match constants.ts, so the code change that follows can make
-- the engine read them with constants as the fallback.
--
-- Idempotent — guarded column adds, delete-then-insert seeds.

begin;

-- ── thresholds ───────────────────────────────────────────────
-- Two kinds of rows, one per grading rule the engine actually has:
--   'diff'  : ingredient vs box-expected, graded on |ordered-estimated|/estimated
--             as a FRACTION — warn_value 0.25, bad_value 0.50, severe_value 0.75
--   'ratio' : S:C / F:C / D:C bands as PERCENT of the 100% ideal —
--             ok 75-125, warn 65-135, bad 50-150, outside = severe
--
-- The engine applies ONE diff rule to all ingredients and ONE band set to all
-- ratios — there is no per-ingredient grading — so the seed is exactly two
-- rows. "Add" in the admin UI is for future per-metric overrides; the loader
-- falls back to these two rows by rule type.

alter table thresholds
  add column if not exists severe_value numeric,
  add column if not exists ok_low numeric,
  add column if not exists ok_high numeric,
  add column if not exists warn_low numeric,
  add column if not exists warn_high numeric,
  add column if not exists bad_low numeric,
  add column if not exists bad_high numeric;

-- warn_value/bad_value only apply to 'diff' rows now; ratio rows use the bands.
alter table thresholds
  alter column warn_value drop not null,
  alter column bad_value drop not null;

-- The seven stale seed rows lied about what drives grading — remove them and
-- seed the engine's real values.
delete from thresholds where metric in (
  'cheese_diff', 'sauce_diff', 'flour_diff',
  'sauce_cheese_low', 'sauce_cheese_high',
  'flour_cheese_low', 'flour_cheese_high',
  'ingredient_diff_pct', 'ratio_bands'
);

insert into thresholds (metric, type, warn_value, bad_value, severe_value)
values ('ingredient_diff_pct', 'diff', 0.25, 0.50, 0.75);

insert into thresholds (metric, type, ok_low, ok_high, warn_low, warn_high, bad_low, bad_high)
values ('ratio_bands', 'ratio', 75, 125, 65, 135, 50, 150);

-- ── usage_assumptions ────────────────────────────────────────
-- The engine's eight box buckets, keyed on DOUGH kg (the "Dough KG" column of
-- James's box-ratio sheet; flour stores divide by 1.6 downstream). Values per
-- BOX for pizza sizes, per PIECE for clamshell/plate. pizza_sales counts the
-- same way (per case of 40 for pizza sizes, per piece for clamshell/plate),
-- mirroring PIZZA_SALES_PER_CASE.
--
-- Box ratios confirmed by James April 28 2026; clamshell/plate per-piece usage
-- revised July 3 2026; party 21x15 = party 20" per his July 6 2026 GINOS058
-- reconciliation.

alter table usage_assumptions
  add column if not exists dough_kg numeric,
  add column if not exists pizza_sales_per_case numeric;

-- Widen the size CHECK to the engine's bucket names. ORDER MATTERS: the old
-- seed's 'party' row is not a valid bucket name under the new CHECK, so the
-- stale rows must be deleted BEFORE the new constraint is added — Postgres
-- validates existing rows at ADD CONSTRAINT time (first attempt failed on
-- exactly this, SQLSTATE 23514).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'usage_assumptions_pizza_size_check') then
    alter table usage_assumptions drop constraint usage_assumptions_pizza_size_check;
  end if;
end $$;

delete from usage_assumptions where pizza_size in
  ('small','medium','large','xl','party','party_20','party_21x15','clamshell','plate');

alter table usage_assumptions
  add constraint usage_assumptions_pizza_size_check
  check (pizza_size in ('small','medium','large','xl','party_20','party_21x15','clamshell','plate'));

insert into usage_assumptions (pizza_size, cheese_oz, sauce_oz, flour_kg, dough_kg, boxes_per_case, pizza_sales_per_case) values
  ('small',        4,  2.5,  0,  0.3,   40, 10),
  ('medium',       6,  4,    0,  0.45,  40, 11),
  ('large',        8,  5,    0,  0.6,   40, 14),
  ('xl',           10, 6,    0,  0.775, 40, 17),
  ('party_20',     16, 10,   0,  1.2,   40, 20),
  ('party_21x15',  16, 10,   0,  1.2,   40, 20),
  ('clamshell',    2,  1.25, 0,  0.15,  1,  1),
  ('plate',        2,  1.25, 0,  0.15,  1,  1);

-- flour_kg is dead (the engine derives flour from dough / 1.6) but dropping a
-- column the old admin build still selects would break the page mid-deploy;
-- it is zeroed above and removed in a later cleanup once nothing reads it.

commit;

-- Verify:
--   select metric, type, warn_value, bad_value, severe_value,
--          ok_low, ok_high, warn_low, warn_high, bad_low, bad_high
--   from thresholds order by metric;
--     -> 2 rows: ingredient_diff_pct (0.25/0.5/0.75), ratio_bands (75/125/65/135/50/150)
--   select pizza_size, cheese_oz, sauce_oz, dough_kg, boxes_per_case, pizza_sales_per_case
--   from usage_assumptions order by pizza_size;
--     -> 8 rows matching BOX_RATIOS + PIZZA_SALES_PER_CASE in constants.ts
