-- 003: Unqualified stage, who-did-what on activities, handoff activity type, app settings.
-- Idempotent: safe to run more than once.

-- 1. Allow the new "unqualified" stage (replace whichever check constraint guards leads.stage)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.leads'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%stage%'
  loop execute format('alter table public.leads drop constraint %I', c.conname); end loop;
end $$;
alter table public.leads add constraint leads_stage_check
  check (stage in ('new','contacted','quoted','negotiating','won','completed','lost','unqualified'));

-- 2. Activities: record who logged each touch, and allow a "handoff" entry
alter table public.activities alter column user_id set default auth.uid();
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.activities'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%type%'
  loop execute format('alter table public.activities drop constraint %I', c.conname); end loop;
end $$;
alter table public.activities add constraint activities_type_check
  check (type in ('call','email','sms','note','stage_change','visit','handoff'));

-- 3. Small key/value settings table (follow-up team: opener, closer, handoff step)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_settings enable row level security;
drop policy if exists "Authenticated users can read settings" on public.app_settings;
create policy "Authenticated users can read settings" on public.app_settings for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated users can write settings" on public.app_settings;
create policy "Authenticated users can write settings" on public.app_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
