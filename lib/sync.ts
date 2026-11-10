// Server-side sync helpers shared by /api/leads/ingest, /api/leads/sync and the cron.
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

export async function ingestRevscale(db: ReturnType<typeof adminDb>, leads: Row[], defaultChannel?: string | null) {
  const result = { total: leads.length, inserted: 0, updated: 0, skipped: 0, errors: 0, firstError: null as string | null }
  const fail = (msg: string) => { result.errors++; result.firstError ??= msg }

  const incoming = leads.filter(l => clean(l.id))
  result.skipped = leads.length - incoming.length

  // Look up what we already hold so CRM edits (stage, notes, names) are never overwritten.
  const existing = new Map<string, Row>()
  for (const ids of chunk(incoming.map(l => String(l.id)), 200)) {
    const { data, error } = await db.from('leads')
      .select('id, revscale_id, first_name, last_name, email, phone, company, title, source_subtype, tags, notes')
      .in('revscale_id', ids)
    if (error) { fail(error.message); continue }
    for (const r of data || []) existing.set(r.revscale_id, r)
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

    if (!prior) {
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
    if (channel) patch.source_subtype = channel
    for (const [k, v] of Object.entries(fields)) if (v && !clean(prior[k])) patch[k] = v
    if (inquiry && !clean(prior.notes)) patch.notes = `Inquiry: ${inquiry}`
    const { error } = await db.from('leads').update(patch).eq('id', prior.id)
    if (error) fail(error.message); else result.updated++
  }

  for (const batch of chunk(inserts, 200)) {
    const { error } = await db.from('leads').insert(batch)
    if (error) { result.errors += batch.length; result.firstError ??= error.message }
    else result.inserted += batch.length
  }
  return result
}

// ── Apollo pull ──────────────────────────────────────────────────────────────

export async function syncApollo(db: ReturnType<typeof adminDb>, budgetMs = 40_000) {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return { ok: false as const, error: 'APOLLO_API_KEY not set' }

  const started = Date.now()
  let page = 1, totalPages = 1, total = 0, imported = 0, errors = 0
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
  return { ok: true as const, imported, total, errors, firstError, complete: page > totalPages }
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
