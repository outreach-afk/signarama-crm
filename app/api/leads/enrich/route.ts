import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/sync'

export const maxDuration = 30

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com', 'msn.com', 'att.net',
  'sbcglobal.net', 'verizon.net', 'comcast.net', 'live.com', 'ymail.com', 'charter.net', 'cox.net', 'netzero.net', 'mac.com', 'proton.me', 'protonmail.com'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function describe(person: Any, org: Any) {
  const lines: string[] = []
  if (person) {
    if (person.title) lines.push(`Role: ${person.title}`)
    if (person.headline && person.headline !== person.title) lines.push(`Headline: ${person.headline}`)
    const loc = [person.city, person.state].filter(Boolean).join(', ')
    if (loc) lines.push(`Location: ${loc}`)
    if (person.linkedin_url) lines.push(`LinkedIn: ${person.linkedin_url}`)
  }
  if (org) {
    lines.push(`Company: ${org.name}`)
    if (org.industry) lines.push(`Industry: ${org.industry}`)
    if (org.estimated_num_employees) lines.push(`Employees: about ${org.estimated_num_employees}`)
    if (org.founded_year) lines.push(`Founded: ${org.founded_year}`)
    const loc = [org.city, org.state].filter(Boolean).join(', ')
    if (loc) lines.push(`Company location: ${loc}`)
    if (org.website_url) lines.push(`Website: ${org.website_url}`)
    if (org.primary_phone?.number || org.phone) lines.push(`Company phone: ${org.primary_phone?.number || org.phone}`)
    if (org.short_description) lines.push(`About: ${String(org.short_description).slice(0, 500)}`)
    if (Array.isArray(org.keywords) && org.keywords.length) lines.push(`Keywords: ${org.keywords.slice(0, 12).join(', ')}`)
  }
  return lines
}

// Look the lead up in Apollo and save what comes back as a note the AI drafts can read.
// Uses Apollo enrichment credits (one per successful person match).
export async function POST(req: NextRequest) {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'APOLLO_API_KEY is not set' }, { status: 500 })
  const { leadId } = await req.json().catch(() => ({}))
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

  const db = adminDb()
  const { data: lead, error } = await db.from('leads').select('*').eq('id', leadId).single()
  if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'Cache-Control': 'no-cache' }
  const domain = (lead.email || '').split('@')[1]?.toLowerCase()
  const bizDomain = domain && !FREE_MAIL.has(domain) ? domain : null
  let person: Any = null, org: Any = null, apiError: string | null = null

  if (lead.email || (lead.first_name && lead.last_name && (lead.company || bizDomain))) {
    const body: Any = { reveal_personal_emails: false, reveal_phone_number: false }
    if (lead.email) body.email = lead.email
    if (lead.first_name) body.first_name = lead.first_name
    if (lead.last_name) body.last_name = lead.last_name
    if (lead.company) body.organization_name = lead.company
    if (bizDomain) body.domain = bizDomain
    const r = await fetch('https://api.apollo.io/api/v1/people/match', { method: 'POST', headers, body: JSON.stringify(body) })
    if (r.ok) { const d = await r.json(); person = d.person || null; org = person?.organization || null }
    else apiError = `Apollo ${r.status}: ${(await r.text()).slice(0, 200)}`
  }
  if (!org && bizDomain) {
    const r = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(bizDomain)}`, { headers })
    if (r.ok) org = (await r.json()).organization || null
    else apiError ??= `Apollo ${r.status}: ${(await r.text()).slice(0, 200)}`
  }

  const lines = describe(person, org)
  if (!lines.length) {
    return NextResponse.json({
      found: false,
      message: apiError || (bizDomain || lead.company
        ? 'Apollo has no record of this person or company.'
        : 'This lead only has a personal email and no company, so there is nothing for Apollo to match on. Add the company name and try again.'),
    })
  }

  const patch: Any = { tags: Array.from(new Set([...(lead.tags || []), 'enriched'])) }
  if (!lead.title && person?.title) patch.title = person.title
  if (!lead.company && org?.name) patch.company = org.name
  if (!lead.first_name && person?.first_name) patch.first_name = person.first_name
  if (!lead.last_name && person?.last_name) patch.last_name = person.last_name
  await db.from('leads').update(patch).eq('id', leadId)
  await db.from('activities').insert([{ lead_id: leadId, type: 'note', outcome: 'enrichment', body: `Apollo enrichment\n${lines.join('\n')}` }])

  return NextResponse.json({ found: true, lines, filled: Object.keys(patch).filter(k => k !== 'tags') })
}
