// What happens to a warm lead the moment it arrives:
//   1. Research it in Apollo (person + company) when there is something to match on.
//   2. Keep what the inquiry asked for and the Revscale qualifier's answers as an "Intake brief" note.
//   3. Estimate the size of the job, say who should work it, and whether the contact decides.
//   4. Queue a welcome text for new inquiries (sent only during business hours).
import type { adminDb } from '@/lib/sync'
import { enrichLead, FREE_MAIL } from '@/lib/enrich'
import { sendSms, toE164 } from '@/lib/messaging'
import { DEFAULT_TEAM, TEAM_KEY, type TeamSettings } from '@/lib/team'
import {
  DEFAULT_ROUTING, DM_LABEL, PRODUCTS, ROUTING_KEY, SIZE_LABEL, decisionMaker, estimate, parseBrief, rangeText, routeFor, type IntakePayload, type RoutingSettings,
} from '@/lib/opportunity'

type Db = ReturnType<typeof adminDb>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export type { IntakePayload } from '@/lib/opportunity'

const SIZING_PREFIXES = ['size:', 'est:', 'dm:']
const MAX_RESEARCH_PER_RUN = 8

export async function loadSettings(db: Db) {
  const { data } = await db.from('app_settings').select('key, value').in('key', [ROUTING_KEY, TEAM_KEY])
  const get = (k: string) => (data || []).find(r => r.key === k)?.value || {}
  return {
    routing: { ...DEFAULT_ROUTING, ...get(ROUTING_KEY) } as RoutingSettings,
    team: { ...DEFAULT_TEAM, ...get(TEAM_KEY) } as TeamSettings,
  }
}

/** Company size and industry from the saved Apollo note, so re-scoring never pays for a second lookup. */
async function companyFacts(db: Db, leadId: string, org?: Row | null) {
  if (org) return { employees: org.estimated_num_employees ?? null, industry: org.industry ?? null }
  const { data } = await db.from('activities').select('body').eq('lead_id', leadId).eq('outcome', 'enrichment')
    .order('created_at', { ascending: false }).limit(1)
  const b = data?.[0]?.body || ''
  return { employees: Number((b.match(/Employees: about (\d+)/) || [])[1]) || null, industry: (b.match(/Industry: (.+)/) || [])[1] || null }
}

const inquiryOf = (lead: Row) => (lead.notes || '').startsWith('Inquiry: ') ? lead.notes.slice(9).split('\n\n')[0] : null

/** Re-score one lead and rewrite its Intake brief. Safe to call any number of times. */
export async function refreshIntake(db: Db, lead: Row, opts: { org?: Row | null; intake?: IntakePayload; settings?: Awaited<ReturnType<typeof loadSettings>> } = {}) {
  const settings = opts.settings || await loadSettings(db)
  const prev = await db.from('activities').select('id, body').eq('lead_id', lead.id).eq('outcome', 'intake').order('created_at', { ascending: false }).limit(1)
  const prevBody: string = prev.data?.[0]?.body || ''
  // The qualifier's answers live in the previous brief when this run brought none.
  const intake: IntakePayload = opts.intake || parseBrief(prevBody)
  const facts = await companyFacts(db, lead.id, opts.org)
  // project_type may hold our own label from an earlier pass: never feed that back into the estimate.
  const ours = PRODUCTS.some(r => r.label === lead.project_type)
  const est = estimate({
    product: intake.product || (ours ? null : lead.project_type), inquiry: intake.inquiry || inquiryOf(lead), company: lead.company,
    industry: facts.industry, employees: facts.employees, qa: intake.qa,
  }, settings.routing)
  const dm = decisionMaker(lead.title, intake.qa)

  const tags = (lead.tags || []).filter((t: string) => !SIZING_PREFIXES.some(p => t.startsWith(p)) && t !== 'rush')
  tags.push(`size:${est.size}`, `dm:${dm.value}`)
  if (est.high) tags.push(`est:${est.low}-${est.high}`)
  if (est.rush) tags.push('rush')
  const patch: Row = { tags }
  if ((!lead.project_type || ours) && (intake.product || est.product) && lead.project_type !== (intake.product || est.product)) patch.project_type = intake.product || est.product
  await db.from('leads').update(patch).eq('id', lead.id)
  Object.assign(lead, patch)

  const suggested = routeFor(est.size, settings.routing)
  const body = brief(intake, est, dm)
  if (body !== prevBody) {
    if (prev.data?.[0]) await db.from('activities').update({ body }).eq('id', prev.data[0].id)
    else await db.from('activities').insert([{ lead_id: lead.id, type: 'note', outcome: 'intake', body }])
  }
  return { est, dm, suggested }
}

// The brief is plain text so it reads well anywhere; the qualifier answers are stored as "Q: … / A: …" pairs.
const one = (v: string | null | undefined) => (v || '').replace(/\s+/g, ' ').trim()
function brief(i: IntakePayload, est: ReturnType<typeof estimate>, dm: ReturnType<typeof decisionMaker>) {
  const out: string[] = ['Intake brief']
  if (i.product || i.inquiry) out.push(`What they want: ${[one(i.product), one(i.inquiry)].filter(Boolean).join(' — ')}`)
  out.push(est.size === 'not_a_fit' ? 'Size: Not a fit — ' + est.reasons[0] : est.high ? `Size: ${SIZE_LABEL[est.size]} · about ${rangeText(est.low, est.high)}` : `Size: ${SIZE_LABEL[est.size]}`)
  out.push(`Why: ${est.reasons.join('; ')}`)
  out.push(`${DM_LABEL[dm.value]}: ${dm.why}`)
  if (i.address || i.zip) out.push(`Job address: ${[i.address, i.zip].filter(Boolean).join(', ')}`)
  if (i.summary) out.push(`Revscale summary: ${one(i.summary)}`)
  if (i.status) out.push(`Qualifier status: ${i.status}`)
  const asked = (i.qa || []).filter(x => x.q && !/^hey|thanks for reaching|best way for our team/i.test(x.q))
  for (const x of asked) out.push(`Q: ${one(x.q)}\nA: ${one(x.a) || '(not answered yet — ask on the call)'}`)
  return out.join('\n')
}

const canResearch = (l: Row) => {
  if ((l.tags || []).includes('enriched')) return false
  const d = (l.email || '').split('@')[1]?.toLowerCase()
  return !!(l.company || (d && !FREE_MAIL.has(d)))
}

/**
 * Run after every Revscale ingest. `fresh` = ids of warm leads inserted in this run (they get researched,
 * routed and welcomed); `intakes` = qualifier data by lead id (updates the brief of new and old leads).
 */
export async function processArrivals(db: Db, fresh: string[], intakes: Map<string, IntakePayload>) {
  const ids = Array.from(new Set([...fresh, ...intakes.keys()]))
  const out = { researched: 0, scored: 0, routed: 0, welcomeQueued: 0, welcome: null as null | Awaited<ReturnType<typeof sendPendingWelcomes>> }
  if (ids.length) {
    const settings = await loadSettings(db)
    const { data: leads } = await db.from('leads').select('*').in('id', ids)
    let budget = MAX_RESEARCH_PER_RUN
    for (const lead of leads || []) {
      const isNew = fresh.includes(lead.id)
      let org: Row | null = null
      if (budget > 0 && canResearch(lead)) {
        budget--
        try { const r = await enrichLead(db, lead); org = r.org; if (r.found) out.researched++ } catch { /* research is a bonus, never block intake */ }
      }
      const { est, suggested } = await refreshIntake(db, lead, { org, intake: intakes.get(lead.id), settings })
      out.scored++
      if (isNew && lead.source_subtype === 'inquiry') {
        // Big jobs go straight to the large-job owner, small ones stay with the small-job owner.
        // Medium jobs keep the normal opener → closer handoff.
        const patch: Row = {}
        if (suggested && (est.size === 'large' || est.size === 'small' || est.size === 'not_a_fit') && suggested !== lead.assigned_to) patch.assigned_to = suggested
        const owner = patch.assigned_to ?? lead.assigned_to
        const tags = [...(lead.tags || [])]
        if ((est.size === 'small' || est.size === 'not_a_fit') && owner === settings.team.opener) tags.push('route:keep')
        if (settings.routing.autoWelcome && toE164(lead.phone) && Date.now() - new Date(lead.created_at).getTime() < 24 * 3600_000 && !tags.some(t => t.startsWith('welcome_'))) {
          tags.push('welcome_pending'); out.welcomeQueued++
        }
        if (tags.length !== (lead.tags || []).length) patch.tags = tags
        if (Object.keys(patch).length) { await db.from('leads').update(patch).eq('id', lead.id); if (patch.assigned_to) out.routed++ }
      }
    }
  }
  out.welcome = await sendPendingWelcomes(db)
  return out
}

/** 8am–7pm Pacific, Monday to Saturday. Texts queued outside those hours wait for the next sync. */
export function inBusinessHours(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now)
  const day = p.find(x => x.type === 'weekday')?.value
  const hour = Number(p.find(x => x.type === 'hour')?.value)
  return day !== 'Sun' && hour >= 8 && hour < 19
}

export function welcomeText(template: string, lead: Row) {
  const product = (lead.project_type || '').trim()
  return template
    .replace(/\{first\}/g, (lead.first_name || 'there').replace(/\b[a-z]/g, (c: string) => c.toUpperCase()))
    .replace(/\{about\}/g, product && !/not something/i.test(product) ? ` about ${product.toLowerCase()}` : '')
    .replace(/\{company\}/g, lead.company || 'your business')
}

export async function sendPendingWelcomes(db: Db) {
  const res = { sent: 0, waiting: 0, failed: 0, firstError: null as string | null }
  const { data } = await db.from('leads').select('id, first_name, phone, company, project_type, tags, created_at').contains('tags', ['welcome_pending']).limit(20)
  if (!data?.length) return res
  if (!inBusinessHours()) { res.waiting = data.length; return res }
  const { routing } = await loadSettings(db)
  for (const lead of data) {
    const tags = (lead.tags || []).filter((t: string) => t !== 'welcome_pending')
    // Too old by now (e.g. queued on Saturday night): a "thanks, we'll call shortly" text would read oddly.
    if (Date.now() - new Date(lead.created_at).getTime() > 48 * 3600_000) {
      await db.from('leads').update({ tags: [...tags, 'welcome_skipped'] }).eq('id', lead.id); continue
    }
    const text = welcomeText(routing.welcomeText || DEFAULT_ROUTING.welcomeText, lead)
    const r = await sendSms(lead.phone, text)
    if (r.ok) {
      res.sent++
      await db.from('leads').update({ tags: [...tags, 'welcome_sent'] }).eq('id', lead.id)
      // Logged as a note, not an SMS touch: the welcome must not count as step 1 of the follow-up.
      await db.from('activities').insert([{ lead_id: lead.id, type: 'note', outcome: 'welcome', body: `Automatic welcome text sent to ${lead.phone}: ${text}` }])
    } else {
      res.failed++; res.firstError ??= r.error
      await db.from('leads').update({ tags: [...tags, 'welcome_failed'] }).eq('id', lead.id)
      await db.from('activities').insert([{ lead_id: lead.id, type: 'note', outcome: 'welcome', body: `Automatic welcome text NOT sent: ${r.error}` }])
    }
  }
  return res
}
