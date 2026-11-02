import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { source } = await req.json().catch(() => ({ source: 'apollo' }))
  const supabase = await createAdminClient()

  if (source === 'apollo') {
    const apiKey = process.env.APOLLO_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'APOLLO_API_KEY not set' }, { status: 500 })

    const res = await fetch('https://api.apollo.io/api/v1/contacts/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ page: 1, per_page: 50 }),
    })

    if (!res.ok) return NextResponse.json({ error: 'Apollo API error' }, { status: 500 })
    const data = await res.json()
    const contacts = data.contacts || []

    let imported = 0
    for (const c of contacts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.from('leads').upsert({ apollo_id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone_numbers?.[0]?.sanitized_number, company: c.organization?.name, title: c.title, source: 'apollo', intent_score: c.intent_score } as any, { onConflict: 'apollo_id', ignoreDuplicates: false })
      if (!error) imported++
    }

    return NextResponse.json({ imported, total: contacts.length })
  }

  if (source === 'revscale') {
    const apiKey = process.env.REVSCALE_API_KEY
    const workspaceId = process.env.REVSCALE_WORKSPACE_ID
    if (!apiKey) return NextResponse.json({ error: 'REVSCALE_API_KEY not set' }, { status: 500 })

    const res = await fetch(`https://api.revscale.ai/v1/workspaces/${workspaceId}/leads`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return NextResponse.json({ error: 'Revscale API error' }, { status: 500 })
    const data = await res.json()
    const leads = data.leads || []

    let imported = 0
    for (const l of leads) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.from('leads').upsert({ revscale_id: l.id, first_name: l.first_name, last_name: l.last_name, email: l.email, company: l.company, title: l.title, source: 'revscale' } as any, { onConflict: 'revscale_id', ignoreDuplicates: false })
      if (!error) imported++
    }

    return NextResponse.json({ imported, total: leads.length })
  }

  return NextResponse.json({ error: 'Unknown source' }, { status: 400 })
}
