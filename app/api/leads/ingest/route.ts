import { NextRequest, NextResponse } from 'next/server'
import { adminDb, dedupeWarm, ingestRevscale, normalizeRevscale, reconcileApollo, revscaleStatus, syncApollo } from '@/lib/sync'

export const maxDuration = 60

// Push endpoint for Revscale leads. Revscale has no server API we can call with a key,
// so the scheduled Claude task reads leads through the Revscale connector and POSTs them here.
// Auth: `x-ingest-secret` header (this route is exempt from the login middleware).
//
// Body: { leads: [...], channel?: 'web_pixel'|'inquiry'|'linkedin_outbound'|'lead_finder', action?: 'normalize' }
//   Each lead: { id, firstName, lastName, email, phone, company, title, program, status,
//                statusBadges, replied, sentiment, createdAt, inquiry }
//   `program` ("Web Pixel" / "Outbound LinkedIn") decides the channel when `channel` is not given.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-ingest-secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = adminDb()
  try {
    if (body.action === 'normalize') {
      const normalized = await normalizeRevscale(db)
      const apollo = normalized.remaining ? null : await reconcileApollo(db)
      return NextResponse.json({ normalized, apollo })
    }
    if (body.action === 'apollo') {
      const r = await syncApollo(db, { startPage: Number(body.page) || 1 })
      return NextResponse.json(r.ok && r.complete ? { ...r, attribution: await reconcileApollo(db) } : r)
    }
    if (body.action === 'reconcile') {
      return NextResponse.json(await reconcileApollo(db))
    }
    if (body.action === 'dedupe') {
      return NextResponse.json(await dedupeWarm(db, body.dryRun !== false))
    }
    if (body.action === 'status') {
      return NextResponse.json(await revscaleStatus(db))
    }

    const leads = body.leads
    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'leads must be a non-empty array' }, { status: 400 })
    }
    const result = await ingestRevscale(db, leads, body.channel ?? body.source_subtype ?? null)
    const apollo = body.reconcile === false ? null : await reconcileApollo(db)
    return NextResponse.json({ imported: result.inserted + result.updated, ...result, apollo })
  } catch (e) {
    return NextResponse.json({ error: 'Ingest failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
