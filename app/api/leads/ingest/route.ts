import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Secure ingest endpoint for leads pushed from external orchestrators (e.g. Claude scheduled task)
// Requires INGEST_SECRET header to prevent unauthorized writes
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-ingest-secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { leads, source, source_subtype } = body
  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ error: 'leads must be a non-empty array' }, { status: 400 })
  }

  let supabase: any
  try {
    supabase = await createAdminClient()
  } catch (e: any) {
    return NextResponse.json({ error: 'Supabase init failed', detail: e?.message }, { status: 500 })
  }

  let imported = 0
  let errors = 0

  for (const lead of leads) {
    const record: any = {
      source: source || lead.source || 'revscale',
      source_subtype: source_subtype || lead.source_subtype || null,
      first_name: lead.firstName ?? lead.first_name ?? null,
      last_name: lead.lastName ?? lead.last_name ?? null,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      company: lead.company ?? null,
      title: lead.title ?? null,
    }

    if (lead.id) {
      if (source === 'revscale' || record.source === 'revscale') {
        record.revscale_id = lead.id
      } else if (source === 'apollo' || record.source === 'apollo') {
        record.apollo_id = lead.id
      }
    }

    if (lead.intent_score != null) record.intent_score = lead.intent_score
    if (lead.notes) record.notes = lead.notes

    // Determine conflict column
    const conflictCol = record.revscale_id ? 'revscale_id' : record.apollo_id ? 'apollo_id' : null

    if (conflictCol) {
      const { error } = await supabase
        .from('leads')
        .upsert(record, { onConflict: conflictCol, ignoreDuplicates: false })
      if (!error) imported++
      else errors++
    } else {
      // No unique ID — insert only if email doesn't exist
      if (record.email) {
        const { error } = await supabase
          .from('leads')
          .upsert(record, { onConflict: 'email', ignoreDuplicates: true })
        if (!error) imported++
        else errors++
      }
    }
  }

  return NextResponse.json({ imported, errors, total: leads.length })
}
