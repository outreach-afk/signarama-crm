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

    if (!res.ok) return NextResponse.json({ error: 'Apollo API error', status: res.status }, { status: 500 })
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

  if (source === 'revscale') {
    const apiKey = process.env.REVSCALE_API_KEY
    const workspaceId = process.env.REVSCALE_WORKSPACE_ID || '68c859b73e538f39fb4ac009'
    if (!apiKey) return NextResponse.json({ error: 'REVSCALE_API_KEY not set' }, { status: 500 })

    let imported = 0
    let total = 0

    // Sync lead_finder leads
    try {
      const lfRes = await fetch(`https://api.revscale.ai/v1/workspaces/${workspaceId}/leads?source=lead_finder`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (lfRes.ok) {
        const lfData = await lfRes.json()
        const lfLeads = lfData.leads || []
        total += lfLeads.length
        for (const l of lfLeads) {
          const { error } = await supabase.from('leads').upsert({
            revscale_id: l.id,
            first_name: l.first_name,
            last_name: l.last_name,
            email: l.email ?? null,
            phone: l.phone ?? null,
            company: l.company ?? null,
            title: l.title ?? null,
            source: 'revscale',
            source_subtype: 'lead_finder',
            intent_score: l.intent_score ?? null,
          } as any, { onConflict: 'revscale_id', ignoreDuplicates: false })
          if (!error) imported++
        }
      }
    } catch (_) { /* continue */ }

    // Sync email_campaign leads
    try {
      const ecRes = await fetch(`https://api.revscale.ai/v1/workspaces/${workspaceId}/leads?source=email_campaign`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (ecRes.ok) {
        const ecData = await ecRes.json()
        const ecLeads = ecData.leads || []
        total += ecLeads.length
        for (const l of ecLeads) {
          const { error } = await supabase.from('leads').upsert({
            revscale_id: l.id ?? `ec_${l.email}`,
            first_name: l.first_name,
            last_name: l.last_name,
            email: l.email ?? null,
            phone: l.phone ?? null,
            company: l.company ?? null,
            title: l.title ?? null,
            source: 'revscale',
            source_subtype: 'email_campaign',
            notes: l.replied
              ? `Replied${l.sentiment ? ` · sentiment: ${l.sentiment}` : ''}`
              : null,
          } as any, { onConflict: 'revscale_id', ignoreDuplicates: false })
          if (!error) imported++
        }
      }
    } catch (_) { /* continue */ }

    return NextResponse.json({ imported, total })
  }

  return NextResponse.json({ error: 'Unknown source. Use apollo or revscale.' }, { status: 400 })
}
