-- 004: server-only settings (e.g. the Gmail refresh token). RLS on and no policies:
-- browsers (anon / authenticated) cannot read or write it; only the service role can.
create table if not exists public.private_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.private_settings enable row level security;
revoke all on public.private_settings from anon, authenticated;
