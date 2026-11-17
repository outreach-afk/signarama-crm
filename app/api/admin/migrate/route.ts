import { NextRequest, NextResponse } from 'next/server'
import { Client } from 'pg'
import { MIGRATION_003 } from './sql'

export const maxDuration = 60

// TEMPORARY: runs one fixed, committed migration and a read-only health check.
// It never runs SQL sent in the request. Protected by INGEST_SECRET. Remove after use.
function db() {
  const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!raw) throw new Error('No Postgres URL configured')
  const u = new URL(raw)
  for (const k of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(k)
  return new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })
}

const mask = (e: string | null) => (e ? `${e.split('@')[0].slice(0, 3)}…@${e.split('@')[1] || ''}` : null)

export async function POST(req: NextRequest) {
  if (req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { action } = await req.json().catch(() => ({}))
  const c = db()
  await c.connect()
  try {
    if (action === 'migrate') {
      const sql = MIGRATION_003
      await c.query('begin')
      try { await c.query(sql); await c.query('commit') } catch (e) { await c.query('rollback'); throw e }
      return NextResponse.json({ ok: true, migrated: '003_close_reasons_and_handoff' })
    }
    const q = async (s: string) => (await c.query(s)).rows
    const profiles = (await q(`select id, full_name, email, role, created_at from public.profiles order by created_at`))
      .map(p => ({ id: p.id, name: p.full_name, email: mask(p.email), role: p.role, since: String(p.created_at).slice(0, 10) }))
    return NextResponse.json({
      db: (await q(`select current_database() db, (select count(*) from public.leads)::int leads`))[0],
      profiles,
      stages: await q(`select stage, count(*)::int n from public.leads group by stage order by n desc`),
      lostReasons: await q(`select lost_reason, count(*)::int n from public.leads where lost_reason is not null group by 1 order by 2 desc limit 15`),
      assigned: (await q(`select count(*)::int n from public.leads where assigned_to is not null`))[0],
      activities: await q(`select type, count(*)::int n, count(user_id)::int with_user from public.activities group by type order by n desc`),
      warmContact: await q(`select source_subtype, count(*)::int total,
          count(*) filter (where coalesce(phone,'') = '')::int no_phone,
          count(*) filter (where coalesce(email,'') = '')::int no_email,
          count(*) filter (where coalesce(phone,'') = '' and coalesce(email,'') = '')::int no_contact
        from public.leads where source = 'revscale' and source_subtype in ('web_pixel','inquiry') group by 1`),
      constraints: await q(`select conrelid::regclass::text tbl, conname, pg_get_constraintdef(oid) def from pg_constraint
        where conrelid in ('public.leads'::regclass, 'public.activities'::regclass) and contype = 'c'`),
      settingsTable: (await q(`select to_regclass('public.app_settings') is not null exists`))[0],
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  } finally {
    await c.end()
  }
}
