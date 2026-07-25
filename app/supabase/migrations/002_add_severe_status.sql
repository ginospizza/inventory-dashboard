-- Add the 'severe' compliance tier (James, July 22 2026).
--
-- All eight status columns carry a CHECK constraint that admits only
-- ('ok','warn','bad'), so the application cannot write 'severe' until this runs.
--
-- ORDERING MATTERS: apply this BEFORE deploying the code that grades stores as
-- 'severe'. Verified against production — an attempted write of 'severe' fails
-- with SQLSTATE 23514 on weekly_metrics_cheese_status_check. If the code ships
-- first, every weekly upload aborts on the constraint and the re-score backfill
-- fails too.
--
-- Idempotent: each constraint is dropped `if exists` before being re-added, so
-- re-running is safe.

begin;

alter table weekly_metrics
  drop constraint if exists weekly_metrics_cheese_status_check,
  drop constraint if exists weekly_metrics_sauce_status_check,
  drop constraint if exists weekly_metrics_flour_status_check,
  drop constraint if exists weekly_metrics_dough_status_check,
  drop constraint if exists weekly_metrics_sauce_cheese_status_check,
  drop constraint if exists weekly_metrics_flour_cheese_status_check,
  drop constraint if exists weekly_metrics_dough_cheese_status_check,
  drop constraint if exists weekly_metrics_overall_status_check;

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
