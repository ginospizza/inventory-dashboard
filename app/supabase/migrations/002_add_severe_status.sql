-- Add the 'severe' compliance tier (James, July 22 2026).
--
-- The eight status columns on weekly_metrics are constrained to
-- ('ok','warn','bad'), so the application cannot write 'severe' until this runs.
--
-- ORDERING MATTERS: apply this BEFORE deploying the code that grades stores as
-- 'severe'. Verified against production that writing 'severe' fails with
-- SQLSTATE 23514 on weekly_metrics_overall_status_check. If the code ships
-- first, every weekly upload aborts on the constraint and the re-score backfill
-- fails too.
--
-- WHY THIS DOESN'T NAME THE CONSTRAINTS IT DROPS
-- The constraints are not named consistently in this database, because the
-- status columns arrived by two different routes:
--   * cheese/sauce/flour/overall/sauce_cheese/flour_cheese came from schema.sql's
--     inline `check (...)`, so Postgres auto-named them
--     weekly_metrics_<column>_check.
--   * dough_status/dough_cheese_status were added later by
--     001_add_dough_columns.sql, which used ADD COLUMN without an inline check
--     and then a separately-named ADD CONSTRAINT chk_dough_status /
--     chk_dough_cheese_status.
-- In production those two chk_* constraints are in fact ABSENT (probing confirms
-- 'severe' is already accepted on both dough columns), so 001's ADD CONSTRAINT
-- statements evidently never took effect there — but they may well exist in
-- another environment, or in any database rebuilt by replaying the migrations.
-- Hard-coding the weekly_metrics_*_check names would therefore silently leave a
-- chk_dough_status behind and keep rejecting 'severe' on that column.
--
-- So: drop EVERY check constraint that references any of the eight status
-- columns, whatever it happens to be called, then add the canonical set back.
-- Idempotent — safe to re-run, and safe whichever route the database took.

begin;

do $$
declare
  status_cols text[] := array[
    'cheese_status', 'sauce_status', 'flour_status', 'dough_status',
    'sauce_cheese_status', 'flour_cheese_status', 'dough_cheese_status',
    'overall_status'
  ];
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'weekly_metrics'
      and nsp.nspname = 'public'
      and con.contype = 'c'                        -- CHECK constraints only
      and exists (
        select 1
        from unnest(con.conkey) as k
        join pg_attribute att
          on att.attrelid = con.conrelid
         and att.attnum = k
        where att.attname = any(status_cols)
      )
  loop
    raise notice 'dropping check constraint %', c.conname;
    execute format('alter table public.weekly_metrics drop constraint %I', c.conname);
  end loop;
end $$;

alter table weekly_metrics
  add constraint weekly_metrics_cheese_status_check
    check (cheese_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_sauce_status_check
    check (sauce_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_flour_status_check
    check (flour_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_dough_status_check
    check (dough_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_sauce_cheese_status_check
    check (sauce_cheese_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_flour_cheese_status_check
    check (flour_cheese_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_dough_cheese_status_check
    check (dough_cheese_status in ('ok', 'warn', 'bad', 'severe')),
  add constraint weekly_metrics_overall_status_check
    check (overall_status in ('ok', 'warn', 'bad', 'severe'));

commit;

-- Verify (expect 8 rows, each listing all four values):
--   select con.conname, pg_get_constraintdef(con.oid)
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   where rel.relname = 'weekly_metrics' and con.contype = 'c'
--   order by con.conname;
