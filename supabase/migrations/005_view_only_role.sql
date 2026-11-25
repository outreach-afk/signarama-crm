-- View-only access.
-- profiles.role = 'viewer' can read everything and change nothing. Enforced here in the database,
-- so it holds even if a screen forgets to hide a button.
-- New sign-ups start as viewers; an editor upgrades them in Settings → Team access.

create or replace function public.can_edit()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role <> 'viewer' from public.profiles where id = auth.uid()), false)
$$;
grant execute on function public.can_edit() to authenticated;

-- Leads
drop policy if exists "Authenticated users can insert leads" on public.leads;
create policy "Editors can insert leads" on public.leads for insert with check (public.can_edit());
drop policy if exists "Authenticated users can update leads" on public.leads;
create policy "Editors can update leads" on public.leads for update using (public.can_edit()) with check (public.can_edit());
drop policy if exists "Editors can delete leads" on public.leads;
create policy "Editors can delete leads" on public.leads for delete using (public.can_edit());

-- Activities
drop policy if exists "Authenticated users can insert activities" on public.activities;
create policy "Editors can insert activities" on public.activities for insert with check (public.can_edit());
drop policy if exists "Editors can update activities" on public.activities;
create policy "Editors can update activities" on public.activities for update using (public.can_edit()) with check (public.can_edit());

-- AI drafts
drop policy if exists "Authenticated users can manage drafts" on public.ai_drafts;
create policy "Authenticated users can read drafts" on public.ai_drafts for select using (auth.role() = 'authenticated');
create policy "Editors can write drafts" on public.ai_drafts for all using (public.can_edit()) with check (public.can_edit());

-- Settings
drop policy if exists "Authenticated users can write settings" on public.app_settings;
create policy "Editors can write settings" on public.app_settings for all using (public.can_edit()) with check (public.can_edit());

-- Nobody changes their own role from the app; roles change only through the server (service role).
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Roles can only be changed in Settings → Team access';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles
  for each row execute procedure public.protect_profile_role();

-- New sign-ups start as view-only.
alter table public.profiles alter column role set default 'viewer';
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'viewer');
  return new;
end;
$$ language plpgsql security definer set search_path = public;
