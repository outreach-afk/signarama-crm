import { NextRequest, NextResponse } from 'next/server'
import { Client } from 'pg'

export const maxDuration = 60

// TEMPORARY: runs one fixed, committed migration (004). Never runs SQL from the request. Remove after use.
const SQL = "-- 004: server-only settings (e.g. the Gmail refresh token). RLS on and no policies:\n-- browsers (anon / authenticated) cannot read or write it; only the service role can.\ncreate table if not exists public.private_settings (\n  key text primary key,\n  value text not null,\n  updated_at timestamptz not null default now()\n);\nalter table public.private_settings enable row level security;\nrevoke all on public.private_settings from anon, authenticated;\n"

export async function POST(req: NextRequest) {
  if (req.headers.get('x-ingest-secret') !== process.env.INGEST_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!raw) return NextResponse.json({ error: 'No Postgres URL' }, { status: 500 })
  const u = new URL(raw); for (const k of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(k)
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query('begin'); await c.query(SQL); await c.query('commit')
    const check = (await c.query(`select relrowsecurity rls, (select count(*) from pg_policies where tablename = 'private_settings')::int policies from pg_class where relname = 'private_settings'`)).rows[0]
    return NextResponse.json({ ok: true, check })
  } catch (e) { await c.query('rollback').catch(() => {}); return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
  finally { await c.end() }
}
