import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/sync'
import { enrichLead } from '@/lib/enrich'
import { refreshIntake } from '@/lib/intake'

export const maxDuration = 30

// Research button: look the lead up in Apollo, save it as a note, then re-score size and decision maker.
export async function POST(req: NextRequest) {
  const { leadId } = await req.json().catch(() => ({}))
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })
  const db = adminDb()
  const { data: lead, error } = await db.from('leads').select('*').eq('id', leadId).single()
  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const r = await enrichLead(db, lead)
  if (r.message === 'APOLLO_API_KEY is not set') return NextResponse.json({ error: r.message }, { status: 500 })
  await refreshIntake(db, lead, { org: r.org })
  return NextResponse.json(r.found ? { found: true, lines: r.lines, filled: r.filled } : { found: false, message: r.message })
}
