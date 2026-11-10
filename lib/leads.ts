// Shared lead vocabulary used by the API routes and the UI.
// `source` is where the record lives (revscale | apollo | ...).
// `source_subtype` is the channel inside that source.

export type Channel = 'web_pixel' | 'inquiry' | 'linkedin_outbound' | 'lead_finder'

export const CHANNELS: Record<Channel, { label: string; short: string; color: string; icon: string; warm: boolean; hint: string }> = {
  web_pixel: {
    label: 'Web Pixel', short: 'Pixel', color: '#3B82F6', icon: '📡', warm: true,
    hint: 'Visitor identified on the website by the Revscale pixel',
  },
  inquiry: {
    label: 'Inquiry', short: 'Inquiry', color: '#10B981', icon: '📨', warm: true,
    hint: 'Submitted an inquiry / quote request (Revscale Inquiry Qualifier)',
  },
  linkedin_outbound: {
    label: 'LinkedIn Outbound', short: 'LinkedIn', color: '#8B5CF6', icon: '💼', warm: false,
    hint: 'Cold LinkedIn outreach run through Revscale',
  },
  lead_finder: {
    label: 'Lead Finder', short: 'Finder', color: '#64748B', icon: '🔍', warm: false,
    hint: 'Prospect sourced by Revscale Lead Finder, not yet engaged',
  },
}

export const WARM_CHANNELS: Channel[] = ['web_pixel', 'inquiry']

// Tags written by the sync. Anything else in `tags` belongs to the user.
export const TAG_APOLLO = 'apollo_outreach'          // matched an Apollo contact by email or name+company
export const TAG_APOLLO_POSSIBLE = 'apollo_possible' // matched an Apollo contact by full name only
export const TAG_IN_SEQUENCE = 'apollo_sequence'     // Apollo contact enrolled in a sequence
const MACHINE_PREFIXES = ['rs:', 'sentiment:']
const MACHINE_TAGS = [TAG_APOLLO, TAG_APOLLO_POSSIBLE, TAG_IN_SEQUENCE]

export function isMachineTag(t: string) {
  return MACHINE_TAGS.includes(t) || MACHINE_PREFIXES.some(p => t.startsWith(p))
}

/** Keep the user's own tags and replace the Revscale-derived ones (`rs:` / `sentiment:`). */
export function mergeRevscaleTags(existing: string[] | null | undefined, fresh: string[]) {
  const keep = (existing || []).filter(t => !MACHINE_PREFIXES.some(p => t.startsWith(p)))
  return Array.from(new Set([...keep, ...fresh]))
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Revscale ids are Mongo ObjectIds: the first 4 bytes are the creation time. */
export function objectIdDate(id: string | null | undefined): string | null {
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) return null
  const ms = parseInt(id.slice(0, 8), 16) * 1000
  if (!Number.isFinite(ms) || ms < 1.5e12 || ms > Date.now() + 86_400_000) return null
  return new Date(ms).toISOString()
}

/** Map whatever Revscale calls the origin onto one of our channels. */
export function channelFor(input: { channel?: string | null; program?: string | null; source?: string | null; email?: string | null }): Channel | null {
  const explicit = slug(input.channel || '')
  if (explicit in CHANNELS) return explicit as Channel
  if (explicit === 'email_campaign' || explicit === '') {
    const p = slug(input.program || '')
    if (p.includes('pixel')) return 'web_pixel'
    if (p.includes('linkedin') || p.includes('outbound')) return 'linkedin_outbound'
    if (p.includes('inbound') || p.includes('inquiry')) return 'inquiry'
    const s = slug(input.source || '')
    if (s === 'lead_finder') return 'lead_finder'
    if (s === 'webpixel' || s === 'web_pixel') return 'web_pixel'
    if (s === 'inbound_email' || s === 'inbound_agent' || s === 'lead_form') return 'inquiry'
    if (explicit === 'email_campaign') return input.email ? 'web_pixel' : 'linkedin_outbound'
  }
  return null
}

export type LeadLike = {
  first_name: string | null; last_name: string | null; email: string | null
  source: string; source_subtype?: string | null; tags?: string[] | null
}

export function fullName(l: { first_name: string | null; last_name: string | null; email: string | null }) {
  const n = [l.first_name, l.last_name].filter(Boolean).join(' ')
  if (!n) return l.email || '(no name)'
  return n.replace(/\b[a-z]/g, c => c.toUpperCase())
}

export function leadChannel(l: LeadLike): Channel | null {
  const c = l.source_subtype as Channel | null | undefined
  return c && c in CHANNELS ? c : null
}

export function apolloMatch(l: LeadLike): 'yes' | 'possible' | null {
  const t = l.tags || []
  if (t.includes(TAG_APOLLO)) return 'yes'
  if (t.includes(TAG_APOLLO_POSSIBLE)) return 'possible'
  return null
}

/** Human label for the newest Revscale status tag, e.g. `rs:email_opened` → "Email opened". */
export function revscaleSignals(l: LeadLike): string[] {
  return (l.tags || [])
    .filter(t => t.startsWith('rs:'))
    .map(t => t.slice(3).replace(/_/g, ' '))
    .map(t => t.charAt(0).toUpperCase() + t.slice(1))
}

export function sentiment(l: LeadLike): { label: string; tone: 'positive' | 'neutral' | 'negative' } | null {
  const t = (l.tags || []).find(x => x.startsWith('sentiment:'))
  if (!t) return null
  const raw = t.slice('sentiment:'.length)
  const tone = raw.startsWith('positive') ? 'positive' : raw.startsWith('negative') ? 'negative' : 'neutral'
  const label = raw.replace(/^(positive|neutral|negative)_/, '').replace(/_/g, ' ')
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone }
}

export function timeAgo(d: string | null | undefined) {
  if (!d) return 'never'
  const mins = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

/** PostgREST caps a select at 1000 rows, so page through until we have everything. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllLeads<T = any>(supabase: any, columns = '*'): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('leads').select(columns)
      .order('created_at', { ascending: false }).order('id')
      .range(from, from + size - 1)
    if (error) throw error
    out.push(...(data as T[]))
    if (!data || data.length < size) break
  }
  return out
}

/** Drive the paged Apollo sync from the browser until it reports `complete`. */
export async function runApolloSync(onProgress?: (msg: string) => void) {
  let page = 1, imported = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let last: any = null
  for (let guard = 0; guard < 60; guard++) {
    const r = await fetch('/api/leads/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'apollo', page }),
    })
    last = await r.json()
    if (!r.ok) throw new Error(last.error ? `${last.error}${last.detail ? ` — ${last.detail}` : ''}` : 'Apollo sync failed')
    imported += last.imported || 0
    if (last.complete || !last.nextPage) break
    page = last.nextPage
    onProgress?.(`Apollo: ${imported.toLocaleString()} of ${(last.total || 0).toLocaleString()} contacts…`)
  }
  return { ...last, imported }
}
