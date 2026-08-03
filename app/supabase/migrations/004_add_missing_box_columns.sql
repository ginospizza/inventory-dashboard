-- Add the three box columns the engine computes but the schema never had.
--
-- The engine has always aggregated party 21x15 boxes, clamshells, and paper
-- plates per store-week, but weekly_metrics only has columns for the five
-- legacy sizes — so the upload route explicitly STRIPS these three fields
-- before upserting, and import-historical never writes them. The result is
-- that the Boxes tab's "Party 21x15", "Clamshell / slice" and "Paper plates"
-- rows have rendered 0 for every store since the tab shipped.
--
-- Clamshells and plates are stored as individual PIECES (the aggregation
-- multiplies cases x units-per-case at intake); party 21x15 is individual
-- boxes like the other pizza sizes. Numeric, matching the engine's output.
--
-- Backfill after applying: re-run import-historical (covers 2025 all weeks +
-- 2026 weeks 1-13, the extent of the raw xlsx) and the targeted
-- backfill-box-columns script (recomputes 2026 week 16+ from weekly_orders).
-- 2026 weeks 14-15 have neither raw-file nor line-item coverage and stay 0.
--
-- Idempotent — safe to re-run.

begin;

alter table weekly_metrics
  add column if not exists boxes_party_21x15 numeric not null default 0,
  add column if not exists boxes_clamshell numeric not null default 0,
  add column if not exists boxes_plates numeric not null default 0;

commit;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'weekly_metrics' and column_name like 'boxes%'
--   order by column_name;
-- Expect 9 rows including boxes_party_21x15, boxes_clamshell, boxes_plates.
