import { NextRequest, NextResponse } from 'next/server'
import { Client } from 'pg'

export const maxDuration = 60

// TEMPORARY: runs one fixed, committed migration (005 view-only role). Never runs SQL from the request. Remove after use.
const SQL = "-- View-only access.\n-- profiles.role = 'viewer' can read everything and change nothing. Enforced here in the database,\n-- so it holds even if a screen forgets to hide a button.\n-- New sign-ups start as viewers; an editor upgrades them in Settings \u2192 Team access.\n\ncreate or replace function public.can_edit()\nreturns boolean\nlanguage sql stable security definer set search_path = public\nas $$\n  select coalesce((select role <> 'viewer' from public.profiles where id = auth.uid()), false)\n$$;\ngrant execute on function public.can_edit() to authenticated;\n\n-- Leads\ndrop policy if exists \"Authenticated users can insert leads\" on public.leads;\ncreate policy \"Editors can insert leads\" on public.leads for insert with check (public.can_edit());\ndrop policy if exists \"Authenticated users can update leads\" on public.leads;\ncreate policy \"Editors can update leads\" on public.leads for update using (public.can_edit()) with check (public.can_edit());\ndrop policy if exists \"Editors can delete leads\" on public.leads;\ncreate policy \"Editors can delete leads\" on public.leads for delete using (public.can_edit());\n\n-- Activities\ndrop policy if exists \"Authenticated users can insert activities\" on public.activities;\ncreate policy \"Editors can insert activities\" on public.activities for insert with check (public.can_edit());\ndrop policy if exists \"Editors can update activities\" on public.activities;\ncreate policy \"Editors can update activities\" on public.activities for update using (public.can_edit()) with check (public.can_edit());\n\n-- AI drafts\ndrop policy if exists \"Authenticated users can manage drafts\" on public.ai_drafts;\ncreate policy \"Authenticated users can read drafts\" on public.ai_drafts for select using (auth.role() = 'authenticated');\ncreate policy \"Editors can write drafts\" on public.ai_drafts for all using (public.can_edit()) with check (public.can_edit());\n\n-- Settings\ndrop policy if exists \"Authenticated users can write settings\" on public.app_settings;\ncreate policy \"Editors can write settings\" on public.app_settings for all using (public.can_edit()) with check (public.can_edit());\n\n-- Nobody changes their own role from the app; roles change only through the server (service role).\ncreate or replace function public.protect_profile_role()\nreturns trigger language plpgsql security definer set search_path = public as $$\nbegin\n  if new.role is distinct from old.role and auth.uid() is not null then\n    raise exception 'Roles can only be changed in Settings \u2192 Team access';\n  end if;\n  return new;\nend;\n$$;\ndrop trigger if exists protect_profile_role on public.profiles;\ncreate trigger protect_profile_role before update on public.profiles\n  for each row execute procedure public.protect_profile_role();\n\n-- New sign-ups start as view-only.\nalter table public.profiles alter column role set default 'viewer';\ncreate or replace function public.handle_new_user()\nreturns trigger as $$\nbegin\n  insert into public.profiles (id, email, full_name, role)\n  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'viewer');\n  return new;\nend;\n$$ language plpgsql security definer set search_path = public;\n"

export async function POST(req: NextRequest) {
  if (req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!raw) return NextResponse.json({ error: 'No Postgres URL' }, { status: 500 })
  const u = new URL(raw); for (const k of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(k)
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const dry = req.nextUrl.searchParams.get('dry') === '1'
    const roles = (await c.query(`select email, role from public.profiles order by created_at`)).rows
    if (dry) return NextResponse.json({ ok: true, dry, roles })
    if (req.nextUrl.searchParams.get('verify') === '1') {
      // Simulate an editor and a viewer inside a transaction that is always rolled back.
      const out: Record<string, unknown> = {}
      const editor = (await c.query(`select id from public.profiles where email = 'outreach@signarama-corona.com'`)).rows[0].id
      const lead = (await c.query(`select id, notes from public.leads order by created_at desc limit 1`)).rows[0]
      for (const [who, sub] of [['editor', editor], ['viewer', '00000000-0000-0000-0000-000000000001']] as const) {
        await c.query('begin')
        try {
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })])
          await c.query('set local role authenticated')
          const ce = (await c.query('select public.can_edit() ce')).rows[0].ce
          const read = (await c.query('select count(*)::int n from public.leads')).rows[0].n
          const upd = await c.query(`update public.leads set notes = notes where id = $1`, [lead.id])
          let settingsWrite = 'ok'
          try { await c.query(`update public.app_settings set updated_at = updated_at where key = 'lead_routing'`) } catch (e) { settingsWrite = (e as Error).message }
          out[who] = { canEdit: ce, leadsVisible: read, leadRowsUpdated: upd.rowCount, settingsWrite }
        } catch (e) { out[who] = { error: (e as Error).message } }
        await c.query('rollback')
      }
      return NextResponse.json({ ok: true, verify: out })
    }
    await c.query('begin'); await c.query(SQL); await c.query('commit')
    const policies = (await c.query(`select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename in ('leads','activities','ai_drafts','app_settings') order by 1,2`)).rows
    return NextResponse.json({ ok: true, roles, policies })
  } catch (e) { await c.query('rollback').catch(() => {}); return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
  finally { await c.end() }
}
