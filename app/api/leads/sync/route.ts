import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { source } = await req.json().catch(() => ({ source: 'apollo' }))
  let supabase: any
  try {
    supabase = await createAdminClient()
  } catch (e: any) {
    return NextResponse.json({ error: 'Supabase init failed', detail: e?.message ?? String(e) }, { status: 500 })
  }

  if (source === 'apollo') {
    const apiKey = process.env.APOLLO_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'APOLLO_API_KEY not set' }, { status: 500 })

    const res = await fetch('https://api.apollo.io/api/v1/contacts/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ page: 1, per_page: 50 }),
    })

    if (!res.ok) {
      let errBody = ''
      try { errBody = await res.text() } catch (_) {}
      return NextResponse.json({ error: 'Apollo API error', status: res.status, detail: errBody }, { status: 500 })
    }
    const data = await res.json()
    const contacts = data.contacts || []

    let imported = 0
    for (const c of contacts) {
      const { error } = await supabase.from('leads').upsert({
        apollo_id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone_numbers?.[0]?.sanitized_number ?? null,
        company: c.organization?.name ?? null,
        title: c.title ?? null,
        source: 'apollo',
        source_subtype: null,
        intent_score: c.intent_score ?? null,
      } as any, { onConflict: 'apollo_id', ignoreDuplicates: false })
      if (!error) imported++
    }

    return NextResponse.json({ imported, total: contacts.length })
  }

  return NextResponse.json({ error: 'Unknown source. Use apollo.' }, { status: 400 })
}
