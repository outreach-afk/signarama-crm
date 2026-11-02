-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  role text not null default 'bdr' check (role in ('owner', 'manager', 'bdr', 'viewer')),
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Users can read all profiles" on public.profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Leads
create table public.leads (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  first_name text,
  last_name text,
  email text,
  phone text,
  company text,
  title text,
  source text not null default 'other' check (source in ('apollo','revscale','website','referral','walk_in','other')),
  stage text not null default 'new' check (stage in ('new','contacted','quoted','negotiating','won','completed','lost')),
  deal_value numeric,
  next_step text,
  next_step_due timestamptz,
  assigned_to uuid references public.profiles(id),
  apollo_id text unique,
  revscale_id text unique,
  intent_score int,
  notes text,
  lost_reason text,
  completed_at timestamptz,
  project_type text,
  tags text[] default '{}'
);
alter table public.leads enable row level security;
create policy "Authenticated users can read leads" on public.leads for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert leads" on public.leads for insert with check (auth.role() = 'authenticated');
create policy "Authenticated users can update leads" on public.leads for update using (auth.role() = 'authenticated');

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
create trigger leads_updated_at before update on public.leads
  for each row execute procedure public.set_updated_at();

-- Enable realtime for leads
alter publication supabase_realtime add table public.leads;

-- Activities
create table public.activities (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamptz default now(),
  lead_id uuid references public.leads(id) on delete cascade not null,
  user_id uuid references public.profiles(id),
  type text not null check (type in ('call','email','sms','note','stage_change','visit')),
  body text,
  outcome text,
  user_name text
);
alter table public.activities enable row level security;
create policy "Authenticated users can read activities" on public.activities for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert activities" on public.activities for insert with check (auth.role() = 'authenticated');

-- AI Drafts
create table public.ai_drafts (
  id uuid default uuid_generate_v4() primary key,
  created_at timestamptz default now(),
  lead_id uuid references public.leads(id) on delete cascade not null,
  draft_type text not null check (draft_type in ('sms','email')),
  to_address text,
  to_phone text,
  subject text,
  body text not null,
  inbox text,
  approved_at timestamptz,
  sent_at timestamptz
);
alter table public.ai_drafts enable row level security;
create policy "Authenticated users can manage drafts" on public.ai_drafts for all using (auth.role() = 'authenticated');

-- Indexes
create index leads_stage_idx on public.leads(stage);
create index leads_source_idx on public.leads(source);
create index leads_created_at_idx on public.leads(created_at desc);
create index leads_next_step_due_idx on public.leads(next_step_due);
create index activities_lead_id_idx on public.activities(lead_id);
create index ai_drafts_lead_id_idx on public.ai_drafts(lead_id);
create index ai_drafts_sent_at_idx on public.ai_drafts(sent_at);
