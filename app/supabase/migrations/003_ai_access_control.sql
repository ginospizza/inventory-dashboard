-- AI Insights access control (James + Raj, July 31 2026).
--
-- They want to roll the app out WITHOUT AI for DSMs, keep it for admins, and
-- later enable it for all DSMs or a selected few (a pilot group), from the
-- admin panel — no redeploy. So this is data, not an env flag:
--
--   dsm_access_mode  'none'      no DSM sees AI (launch default)
--                    'all'       every DSM sees AI
--                    'selected'  only DSMs in allowed_dsm_ids see AI
--
-- Super admins always have access regardless of mode.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS throughout; safe to re-run.

begin;

alter table ai_config
  add column if not exists dsm_access_mode text not null default 'none',
  add column if not exists allowed_dsm_ids uuid[] not null default '{}';

-- CHECK added separately so re-running doesn't fail on a duplicate name.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_config_dsm_access_mode_check'
  ) then
    alter table ai_config
      add constraint ai_config_dsm_access_mode_check
      check (dsm_access_mode in ('none', 'all', 'selected'));
  end if;
end $$;

commit;

-- Verify:
--   select dsm_access_mode, allowed_dsm_ids from ai_config;
-- Expect one row: 'none', {}
