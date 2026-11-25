import { NextRequest, NextResponse } from 'next/server'
import { Client } from 'pg'

export const maxDuration = 60

// TEMPORARY: runs one fixed, committed migration (006 owner approval). Never runs SQL from the request. Remove after use.
const SQL = "-- Owner approval. New sign-ups wait as 'pending' and see nothing until the owner approves them.\n-- Roles: owner (approves people, edits) \u00b7 manager / bdr (edit) \u00b7 viewer (read only) \u00b7 pending (waiting) \u00b7 denied (blocked).\n-- Only the owner changes roles, through the server (Settings \u2192 Team access).\n\nalter table public.profiles drop constraint if exists profiles_role_check;\nalter table public.profiles add constraint profiles_role_check\n  check (role in ('owner', 'manager', 'bdr', 'viewer', 'pending', 'denied'));\n\ncreate or replace function public.can_view()\nreturns boolean language sql stable security definer set search_path = public as $$\n  select coalesce((select role in ('owner', 'manager', 'bdr', 'viewer') from public.profiles where id = auth.uid()), false)\n$$;\ncreate or replace function public.can_edit()\nreturns boolean language sql stable security definer set search_path = public as $$\n  select coalesce((select role in ('owner', 'manager', 'bdr') from public.profiles where id = auth.uid()), false)\n$$;\ngrant execute on function public.can_view() to authenticated;\n\n-- Reading now needs an approved account.\ndrop policy if exists \"Authenticated users can read leads\" on public.leads;\ncreate policy \"Approved users can read leads\" on public.leads for select using (public.can_view());\ndrop policy if exists \"Authenticated users can read activities\" on public.activities;\ncreate policy \"Approved users can read activities\" on public.activities for select using (public.can_view());\ndrop policy if exists \"Authenticated users can read drafts\" on public.ai_drafts;\ncreate policy \"Approved users can read drafts\" on public.ai_drafts for select using (public.can_view());\ndrop policy if exists \"Authenticated users can read settings\" on public.app_settings;\ncreate policy \"Approved users can read settings\" on public.app_settings for select using (public.can_view());\ndrop policy if exists \"Users can read all profiles\" on public.profiles;\ncreate policy \"Approved users read profiles, everyone reads their own\" on public.profiles for select\n  using (public.can_view() or id = auth.uid());\n\n-- New sign-ups wait for approval.\nalter table public.profiles alter column role set default 'pending';\ncreate or replace function public.handle_new_user()\nreturns trigger as $$\nbegin\n  insert into public.profiles (id, email, full_name, role)\n  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'pending');\n  return new;\nend;\n$$ language plpgsql security definer set search_path = public;\n\n-- Orlando is the owner: the only one who can let people in.\nupdate public.profiles set role = 'owner' where email = 'outreach@signarama-corona.com';\n"

export async function POST(req: NextRequest) {
  if (req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!raw) return NextResponse.json({ error: 'No Postgres URL' }, { status: 500 })
  const u = new URL(raw); for (const k of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(k)
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const mode = req.nextUrl.searchParams.get('mode')
    const roles = (await c.query(`select email, role from public.profiles order by created_at`)).rows
    const tables = (await c.query(`select c.relname t, c.relrowsecurity rls, coalesce(json_agg(p.policyname || ' [' || p.cmd || '] ' || coalesce(p.qual, '')) filter (where p.policyname is not null), '[]') policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
      where n.nspname = 'public' and c.relkind = 'r' group by 1, 2 order by 1`)).rows
    if (mode === 'dry') return NextResponse.json({ ok: true, roles, tables })
    if (mode === 'verify') {
      const out: Record<string, unknown> = {}
      const ids = Object.fromEntries((await c.query(`select email, id from public.profiles`)).rows.map(r => [r.email, r.id]))
      for (const [who, sub, role] of [['owner', ids['outreach@signarama-corona.com'], null], ['pending', '00000000-0000-0000-0000-000000000002', 'pending'], ['viewer', '00000000-0000-0000-0000-000000000003', 'viewer']] as const) {
        await c.query('begin')
        try {
          if (role) {
            await c.query(`insert into auth.users (id, email, instance_id, aud, role) values ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [sub, `test-${role}@example.invalid`])
            await c.query(`update public.profiles set role = $2 where id = $1`, [sub, role])
          }
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })])
          await c.query('set local role authenticated')
          const v = (await c.query('select public.can_view() v, public.can_edit() e')).rows[0]
          const leads = (await c.query('select count(*)::int n from public.leads')).rows[0].n
          const profiles = (await c.query('select count(*)::int n from public.profiles')).rows[0].n
          const upd = (await c.query(`update public.leads set notes = notes where id = (select id from public.leads limit 1)`)).rowCount
          out[who] = { canView: v.v, canEdit: v.e, leadsVisible: leads, profilesVisible: profiles, leadRowsUpdated: upd }
        } catch (e) { out[who] = { error: (e as Error).message } }
        await c.query('rollback')
      }
      return NextResponse.json({ ok: true, verify: out })
    }
    await c.query('begin'); await c.query(SQL); await c.query('commit')
    return NextResponse.json({ ok: true, roles: (await c.query(`select email, role from public.profiles order by created_at`)).rows })
  } catch (e) { await c.query('rollback').catch(() => {}); return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
  finally { await c.end() }
}
