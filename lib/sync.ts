// Server-side sync helpers shared by /api/leads/ingest, /api/leads/sync and the cron.
import { createHash } from 'crypto'
import { createClient as createSupabase } from '@supabase/supabase-js'
import {
  TAG_APOLLO, TAG_APOLLO_POSSIBLE, TAG_IN_SEQUENCE, channelFor, fetchAllLeads,
  mergeRevscaleTags, objectIdDate, slug,
} from '@/lib/leads'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/** Service-role client with no cookie handling — safe for cron and webhook callers. */
export function adminDb() {
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/** Private key for the calendar feed address, derived from a server secret. */
export function calendarToken() {
  return createHash('sha256').update(`${process.env.INGEST_SECRET || 'unset'}:calendar-feed`).digest('hex').slice(0, 32)
}

const clean = (v: unknown) => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}
const norm = (v: unknown) => (clean(v) || '').toLowerCase()

function chunk<T>(arr: T[], n: number) {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// ── Revscale ingest ──────────────────────────────────────────────────────────

function revscaleTags(lead: Row): string[] {
  const tags = new Set<string>()
  const badges: unknown[] = Array.isArray(lead.statusBadges) ? lead.statusBadges : []
  for (const b of [...badges, lead.status]) {
    const s = slug(String(b || ''))
    if (s && s !== 'completed') tags.add(`rs:${s}`)
  }
  if (lead.replied) tags.add('rs:replied')
  if (lead.sentiment) tags.add(`sentiment:${slug(String(lead.sentiment))}`)
  if (lead.lastCheckpoint) tags.add(`rs:${slug(String(lead.lastCheckpoint))}`)
  return Array.from(tags)
}

const SEL = 'id, revscale_id, first_name, last_name, email, phone, company, title, source_subtype, tags, notes'

/** Channel + tags for a lead that has been seen through two warm channels. Inquiry outranks pixel. */
function mergedChannel(a: string | null, b: string | null, tags: string[], inquiryAt?: string | null) {
  const out = new Set(tags)
  const both = a && b && a !== b && [a, b].includes('inquiry') && [a, b].includes('web_pixel')
  if (both) out.add('also:web_pixel')
  if (inquiryAt && (a === 'inquiry' || b === 'inquiry') && ![...out].some(t => t.startsWith('inquiry_at:'))) out.add(`inquiry_at:${inquiryAt.slice(0, 10)}`)
  return { channel: a === 'inquiry' || b === 'inquiry' ? 'inquiry' : a || b, tags: Array.from(out) }
}

export async function ingestRevscale(db: ReturnType<typeof adminDb>, leads: Row[], defaultChannel?: string | null) {
  const result = { total: leads.length, inserted: 0, updated: 0, skipped: 0, errors: 0, firstError: null as string | null, merged: 0, newWarm: [] as Row[], needDetails: [] as string[] }
  const fail = (msg: string) => { result.errors++; result.firstError ??= msg }

  const incoming = leads.filter(l => clean(l.id))
  result.skipped = leads.length - incoming.length

  // Look up what we already hold so CRM edits (stage, notes, names) are never overwritten.
  const existing = new Map<string, Row>()
  for (const ids of chunk(incoming.map(l => String(l.id)), 200)) {
    const { data, error } = await db.from('leads')
      .select(SEL)
      .in('revscale_id', ids)
    if (error) { fail(error.message); continue }
    for (const r of data || []) existing.set(r.revscale_id, r)

    // A lead merged into another keeps its Revscale id as an `rsid:` tag on the survivor.
    const { data: merged } = await db.from('leads').select(`${SEL}, stage`).overlaps('tags', ids.map(i => `rsid:${i}`))
    for (const r of merged || []) for (const t of (r.tags || []) as string[]) if (t.startsWith('rsid:')) existing.set(t.slice(5), r)
  }

  // One person, one lead: index the warm leads we hold by email so a visitor who is
  // identified by the pixel and then sends an inquiry (or the reverse) is merged, not duplicated.
  const byEmail = new Map<string, Row>()
  {
    const { data } = await db.from('leads').select(`${SEL}, stage, created_at`)
      .eq('source', 'revscale').in('source_subtype', ['web_pixel', 'inquiry']).not('email', 'is', null).limit(5000)
    for (const r of data || []) { const k = norm(r.email); if (k && !byEmail.has(k)) byEmail.set(k, r) }
  }

  const inserts: Row[] = []
  for (const lead of incoming) {
    const id = String(lead.id)
    const email = clean(lead.email)
    const channel = channelFor({
      channel: lead.channel ?? defaultChannel, program: lead.program, source: lead.source, email,
    })
    const fields: Row = {
      first_name: clean(lead.firstName ?? lead.first_name),
      last_name: clean(lead.lastName ?? lead.last_name),
      email,
      phone: clean(lead.phone),
      company: clean(lead.company),
      title: clean(lead.title),
    }
    const tags = revscaleTags(lead)
    const inquiry = clean(lead.inquiry)
    const prior = existing.get(id)

    // Inquiries arrive from the activity feed as id + email only; ask the caller for the rest.
    if (channel === 'inquiry' && !fields.first_name && !clean(prior?.first_name)) result.needDetails.push(id)

    // Same person already in the CRM under another Revscale id → fold this record into that lead.
    const twin = !prior && email && (channel === 'web_pixel' || channel === 'inquiry') ? byEmail.get(norm(email)) : null
    if (twin && !twin.id) { result.skipped++; continue } // same person twice in one batch; next sync merges it
    if (twin) {
      const born = clean(lead.createdAt) || objectIdDate(id)
      const m = mergedChannel(twin.source_subtype, channel, [...mergeRevscaleTags(twin.tags, tags), `rsid:${id}`], channel === 'inquiry' ? born : null)
      const patch: Row = { tags: m.tags, source_subtype: m.channel }
      for (const [k, v] of Object.entries(fields)) if (v && !clean(twin[k])) patch[k] = v
      if (inquiry && !(twin.notes || '').includes(inquiry.slice(0, 40))) patch.notes = [`Inquiry: ${inquiry}`, clean(twin.notes)].filter(Boolean).join('\n\n')
      const { error } = await db.from('leads').update(patch).eq('id', twin.id)
      if (error) { fail(error.message); continue }
      result.merged++
      Object.assign(twin, patch); existing.set(id, twin)
      // A known visitor who now sends an inquiry is news worth an alert.
      if (channel === 'inquiry' && (fields.first_name || twin.first_name)) {
        result.newWarm.push({
          name: [twin.first_name, twin.last_name].filter(Boolean).join(' ') || email, channel: 'inquiry', company: twin.company,
          email, phone: twin.phone, inquiry: inquiry ? inquiry.slice(0, 290) : null, alsoVisitedSite: true,
          url: `https://signarama-crm.vercel.app/leads/${twin.id}`,
        })
      }
      continue
    }

    if (!prior) {
      if (email && (channel === 'web_pixel' || channel === 'inquiry')) byEmail.set(norm(email), { ...fields, source_subtype: channel, tags, notes: null, _pending: id })
      const noteParts = [inquiry ? `Inquiry: ${inquiry}` : null, clean(lead.notes)].filter(Boolean)
      inserts.push({
        ...fields,
        source: 'revscale',
        source_subtype: channel,
        revscale_id: id,
        tags,
        notes: noteParts.length ? noteParts.join('\n\n') : null,
        intent_score: lead.intent_score ?? lead.leadScore ?? null,
        created_at: clean(lead.createdAt) || objectIdDate(id) || new Date().toISOString(),
      })
      continue
    }

    // Existing lead: refresh Revscale-owned fields, only fill blanks for the rest.
    const patch: Row = { tags: mergeRevscaleTags(prior.tags, tags) }
    if (channel) {
      const m = mergedChannel(prior.source_subtype, channel, patch.tags)
      const warmPair = ['web_pixel', 'inquiry'].includes(prior.source_subtype) && ['web_pixel', 'inquiry'].includes(channel)
      patch.source_subtype = warmPair ? m.channel : channel
      if (warmPair) patch.tags = m.tags
    }
    for (const [k, v] of Object.entries(fields)) if (v && !clean(prior[k])) patch[k] = v
    if (inquiry && !clean(prior.notes)) patch.notes = `Inquiry: ${inquiry}`
    const detailsArrived = channel === 'inquiry' && fields.first_name && !clean(prior.first_name)
    const { error } = await db.from('leads').update(patch).eq('id', prior.id)
    if (error) fail(error.message); else result.updated++
    if (!error && detailsArrived) {
      result.newWarm.push({
        name: [fields.first_name, fields.last_name].filter(Boolean).join(' '), channel, company: fields.company,
        email: email || prior.email, phone: fields.phone, inquiry: inquiry ? inquiry.slice(0, 290) : null,
        url: `https://signarama-crm.vercel.app/leads/${prior.id}`,
      })
    }
  }

  for (const batch of chunk(inserts, 200)) {
    const { data, error } = await db.from('leads').insert(batch)
      .select('id, first_name, last_name, email, phone, company, source_subtype, notes')
    if (error) { result.errors += batch.length; result.firstError ??= error.message; continue }
    result.inserted += batch.length
    for (const r of data || []) {
      if (r.source_subtype !== 'web_pixel' && r.source_subtype !== 'inquiry') continue
      if (r.source_subtype === 'inquiry' && !r.first_name) continue // alerted once its details arrive
      result.newWarm.push({
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Unknown',
        channel: r.source_subtype, company: r.company, email: r.email, phone: r.phone,
        inquiry: (r.notes || '').startsWith('Inquiry: ') ? r.notes.slice(9, 300) : null,
        url: `https://signarama-crm.vercel.app/leads/${r.id}`,
      })
    }
  }
  return result
}

// ── Apollo pull ──────────────────────────────────────────────────────────────

export async function syncApollo(db: ReturnType<typeof adminDb>, opts: { startPage?: number; budgetMs?: number } = {}) {
  const budgetMs = opts.budgetMs ?? 20_000
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return { ok: false as const, error: 'APOLLO_API_KEY not set' }

  const started = Date.now()
  let page = Math.max(1, opts.startPage ?? 1), totalPages = page, total = 0, imported = 0, errors = 0
  let firstError: string | null = null

  while (page <= totalPages && Date.now() - started < budgetMs) {
    const res = await fetch('https://api.apollo.io/api/v1/contacts/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ page, per_page: 100, sort_by_field: 'contact_created_at', sort_ascending: false }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false as const, error: `Apollo API error ${res.status}`, detail: detail.slice(0, 300), imported, total }
    }
    const data = await res.json()
    const contacts: Row[] = data.contacts || []
    totalPages = data.pagination?.total_pages ?? totalPages
    total = data.pagination?.total_entries ?? total + contacts.length
    if (contacts.length === 0) break

    const ids = contacts.map(c => c.id)
    const { data: have } = await db.from('leads').select('apollo_id, tags').in('apollo_id', ids)
    const haveTags = new Map((have || []).map(r => [r.apollo_id, (r.tags || []) as string[]]))

    const rows = contacts.map(c => {
      const inSeq = (c.emailer_campaign_ids || c.contact_campaign_statuses || []).length > 0
      const prior = (haveTags.get(c.id) || []).filter(t => t !== TAG_IN_SEQUENCE)
      const row: Row = {
        apollo_id: c.id,
        first_name: clean(c.first_name),
        last_name: clean(c.last_name),
        email: clean(c.email),
        phone: clean(c.phone_numbers?.[0]?.sanitized_number ?? c.sanitized_phone),
        company: clean(c.organization_name ?? c.organization?.name ?? c.account?.name),
        title: clean(c.title),
        source: 'apollo',
        tags: inSeq ? [...prior, TAG_IN_SEQUENCE] : prior,
      }
      if (!haveTags.has(c.id) && c.created_at) row.created_at = c.created_at
      return row
    })
    // Two shapes (with / without created_at) can't share one upsert payload.
    for (const group of [rows.filter(r => r.created_at), rows.filter(r => !r.created_at)]) {
      if (!group.length) continue
      const { error } = await db.from('leads').upsert(group, { onConflict: 'apollo_id' })
      if (error) { errors += group.length; firstError ??= error.message } else imported += group.length
    }
    page++
  }
  // Newest contacts come first, so even a partial run picks up everything recent.
  const complete = page > totalPages
  return { ok: true as const, imported, total, errors, firstError, complete, nextPage: complete ? null : page, totalPages }
}

// ── Apollo → Revscale attribution ────────────────────────────────────────────

/**
 * Flag Revscale leads that we first reached through Apollo.
 * Email match or name+company match  → `apollo_outreach`
 * Full-name-only match               → `apollo_possible` (pixel often resolves a personal email)
 */
export async function reconcileApollo(db: ReturnType<typeof adminDb>) {
  const all = await fetchAllLeads<Row>(db, 'id, source, first_name, last_name, email, company, tags')
  const apollo = all.filter(l => l.source === 'apollo')
  const byEmail = new Set(apollo.map(l => norm(l.email)).filter(Boolean))
  const nameKey = (l: Row) => (norm(l.first_name) && norm(l.last_name) ? `${norm(l.first_name)} ${norm(l.last_name)}` : '')
  const byName = new Set(apollo.map(nameKey).filter(Boolean))
  const byNameCo = new Set(apollo.filter(l => nameKey(l) && norm(l.company)).map(l => `${nameKey(l)}|${norm(l.company)}`))

  let matched = 0, possible = 0, changed = 0
  for (const l of all) {
    if (l.source !== 'revscale') continue
    const n = nameKey(l)
    const strong = (norm(l.email) && byEmail.has(norm(l.email))) || (n && norm(l.company) && byNameCo.has(`${n}|${norm(l.company)}`))
    const weak = !strong && n && byName.has(n)
    if (strong) matched++
    if (weak) possible++

    const base = ((l.tags || []) as string[]).filter(t => t !== TAG_APOLLO && t !== TAG_APOLLO_POSSIBLE)
    const next = strong ? [...base, TAG_APOLLO] : weak ? [...base, TAG_APOLLO_POSSIBLE] : base
    const before = [...(l.tags || [])].sort().join(',')
    if (before !== [...next].sort().join(',')) {
      const { error } = await db.from('leads').update({ tags: next }).eq('id', l.id)
      if (!error) changed++
    }
  }
  return { apolloContacts: apollo.length, matched, possible, changed }
}

// ── Revscale status (it is push-only, so we report freshness instead of pulling) ──

export async function revscaleStatus(db: ReturnType<typeof adminDb>) {
  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('source', 'revscale')
  const { data: touched } = await db.from('leads').select('updated_at')
    .eq('source', 'revscale').order('updated_at', { ascending: false }).limit(1)
  const { data: newest } = await db.from('leads').select('created_at')
    .eq('source', 'revscale').in('source_subtype', ['web_pixel', 'inquiry'])
    .order('created_at', { ascending: false }).limit(1)
  return {
    total: count ?? 0,
    lastSyncedAt: touched?.[0]?.updated_at ?? null,
    newestWarmLeadAt: newest?.[0]?.created_at ?? null,
  }
}

// ── One-off / idempotent clean-up of rows imported before channels existed ───

export async function normalizeRevscale(db: ReturnType<typeof adminDb>) {
  const all = (await fetchAllLeads<Row>(db, 'id, source, source_subtype, revscale_id, email, notes, tags, created_at'))
    .filter(l => l.source === 'revscale')
  let changed = 0, errors = 0
  const counts: Record<string, number> = {}
  const patches: { id: string; patch: Row }[] = []

  for (const l of all) {
    const patch: Row = {}
    const email = clean(l.email)
    if (l.email !== email) patch.email = email

    let channel = l.source_subtype as string | null
    if (channel === 'email_campaign' || !channel) {
      channel = channelFor({ channel: 'email_campaign', email }) // pixel leads always carry an email, LinkedIn ones never do
      patch.source_subtype = channel
    }
    counts[channel || 'unknown'] = (counts[channel || 'unknown'] || 0) + 1

    const born = objectIdDate(l.revscale_id)
    if (born && Math.abs(new Date(born).getTime() - new Date(l.created_at).getTime()) > 60_000) patch.created_at = born

    // Old imports wrote "Replied · sentiment: x" into notes; move that into tags.
    const m = /^Replied(?: · sentiment: (\S+))?$/.exec((l.notes || '').trim())
    if (m) {
      patch.notes = null
      patch.tags = mergeRevscaleTags(l.tags, ['rs:replied', ...(m[1] ? [`sentiment:${slug(m[1])}`] : [])])
    }

    if (Object.keys(patch).length) patches.push({ id: l.id, patch })
  }

  // Run in small parallel groups and stop before the function time limit; safe to call again.
  const started = Date.now()
  let remaining = patches.length
  for (const group of chunk(patches, 20)) {
    if (Date.now() - started > 40_000) break
    const res = await Promise.all(group.map(p => db.from('leads').update(p.patch).eq('id', p.id)))
    for (const r of res) { if (r.error) errors++; else changed++ }
    remaining -= group.length
  }
  return { revscaleLeads: all.length, changed, errors, remaining, channels: counts }
}

// ── Merge warm leads that are the same person (same email) ───────────────────

export async function dedupeWarm(db: ReturnType<typeof adminDb>, dryRun = false) {
  const { data, error } = await db.from('leads').select('*')
    .eq('source', 'revscale').in('source_subtype', ['web_pixel', 'inquiry']).not('email', 'is', null).limit(5000)
  if (error) throw error
  const groups = new Map<string, Row[]>()
  for (const r of data || []) { const k = norm(r.email); if (!k) continue; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]) }

  const report: Row[] = []
  let removed = 0, errors = 0
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    // Keep the record someone has worked; otherwise the inquiry; otherwise the oldest.
    const rank = (r: Row) => (r.stage !== 'new' ? 4 : 0) + (r.deal_value ? 2 : 0) + (r.source_subtype === 'inquiry' ? 1 : 0)
    rows.sort((a, b) => rank(b) - rank(a) || a.created_at.localeCompare(b.created_at))
    const [keep, ...dups] = rows
    const inq = rows.filter(r => r.source_subtype === 'inquiry').sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    let tags: string[] = keep.tags || []
    let channel: string | null = keep.source_subtype
    const patch: Row = {}
    const notes = [clean(keep.notes)]
    for (const d of dups) {
      const m = mergedChannel(channel, d.source_subtype, [...tags, ...(d.tags || []), `rsid:${d.revscale_id}`], inq?.created_at)
      tags = m.tags; channel = m.channel
      for (const k of ['first_name', 'last_name', 'phone', 'company', 'title', 'deal_value', 'next_step', 'next_step_due', 'project_type']) {
        if (d[k] && !keep[k] && !patch[k]) patch[k] = d[k]
      }
      if (clean(d.notes) && !notes.some(n => n && n.includes(d.notes.slice(0, 40)))) notes.unshift(d.notes)
    }
    patch.tags = Array.from(new Set(tags)); patch.source_subtype = channel
    patch.notes = notes.filter(Boolean).join('\n\n') || null
    patch.created_at = rows.map(r => r.created_at).sort()[0] // first time we ever saw them
    report.push({ email: keep.email, kept: keep.id, removed: dups.length, channels: rows.map(r => r.source_subtype) })
    if (dryRun) continue

    const up = await db.from('leads').update(patch).eq('id', keep.id)
    if (up.error) { errors++; continue }
    for (const d of dups) {
      await db.from('activities').update({ lead_id: keep.id }).eq('lead_id', d.id)
      await db.from('ai_drafts').update({ lead_id: keep.id }).eq('lead_id', d.id)
      const del = await db.from('leads').delete().eq('id', d.id)
      if (del.error) errors++; else removed++
    }
  }
  // Same person under two different emails (the pixel often resolves a personal address): report, never auto-merge.
  const phone = (v: unknown) => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 && !/^0+$/.test(d) ? d : '' }
  const alt = new Map<string, Row[]>()
  for (const r of data || []) {
    const keys = [norm(r.first_name) && norm(r.last_name) ? `n:${norm(r.first_name)} ${norm(r.last_name)}` : '', phone(r.phone) ? `p:${phone(r.phone)}` : ''].filter(Boolean)
    for (const k of keys) { const g = alt.get(k); if (g) g.push(r); else alt.set(k, [r]) }
  }
  const seen = new Set<string>()
  const possible: Row[] = []
  for (const [k, rows] of alt) {
    const emails = new Set(rows.map(r => norm(r.email)))
    if (rows.length < 2 || emails.size < 2) continue
    const sig = rows.map(r => r.id).sort().join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    possible.push({ by: k.startsWith('n:') ? 'name' : 'phone', name: [rows[0].first_name, rows[0].last_name].filter(Boolean).join(' '), ids: rows.map(r => r.id), channels: rows.map(r => r.source_subtype), dates: rows.map(r => r.created_at.slice(0, 10)), companies: rows.map(r => r.company) })
  }
  return { duplicateGroups: report.length, removed, errors, dryRun, sample: report.slice(0, 40), possible }
}
