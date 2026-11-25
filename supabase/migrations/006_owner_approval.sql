-- Owner approval. New sign-ups wait as 'pending' and see nothing until the owner approves them.
-- Roles: owner (approves people, edits) · manager / bdr (edit) · viewer (read only) · pending (waiting) · denied (blocked).
-- Only the owner changes roles, through the server (Settings → Team access).

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'manager', 'bdr', 'viewer', 'pending', 'denied'));

create or replace function public.can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner', 'manager', 'bdr', 'viewer') from public.profiles where id = auth.uid()), false)
$$;
create or replace function public.can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner', 'manager', 'bdr') from public.profiles where id = auth.uid()), false)
$$;
grant execute on function public.can_view() to authenticated;

-- Reading now needs an approved account.
drop policy if exists "Authenticated users can read leads" on public.leads;
create policy "Approved users can read leads" on public.leads for select using (public.can_view());
drop policy if exists "Authenticated users can read activities" on public.activities;
create policy "Approved users can read activities" on public.activities for select using (public.can_view());
drop policy if exists "Authenticated users can read drafts" on public.ai_drafts;
create policy "Approved users can read drafts" on public.ai_drafts for select using (public.can_view());
drop policy if exists "Authenticated users can read settings" on public.app_settings;
create policy "Approved users can read settings" on public.app_settings for select using (public.can_view());
drop policy if exists "Users can read all profiles" on public.profiles;
create policy "Approved users read profiles, everyone reads their own" on public.profiles for select
  using (public.can_view() or id = auth.uid());

-- New sign-ups wait for approval.
alter table public.profiles alter column role set default 'pending';
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'pending');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Orlando is the owner: the only one who can let people in.
update public.profiles set role = 'owner' where email = 'outreach@signarama-corona.com';
