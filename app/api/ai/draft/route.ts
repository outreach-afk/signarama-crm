import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/sync'
import { cadenceFor, cadenceTouches, followUp, stepsDone } from '@/lib/cadence'
import { stepTemplate } from '@/lib/templates'
import { parseBrief } from '@/lib/opportunity'

export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const SHOP = `Signarama Corona is a family-owned sign shop in Corona, California. It designs, makes and installs:
building and storefront signs, channel letters, monument signs, lobby and reception signs, wayfinding and ADA signs,
window and wall graphics, vehicle wraps and lettering, banners, yard and real-estate signs, A-frames, trade-show displays, decals and magnets.
Phone (951) 444-7269.`

/** What we know about this person, in plain lines the model (and the template) can use. */
function context(lead: Any, acts: Any[]) {
  const inquiry = (lead.notes || '').startsWith('Inquiry: ') ? lead.notes.slice(9).split('\n\n')[0] : null
  const enrichment = acts.find(a => a.outcome === 'enrichment')?.body?.replace(/^Apollo enrichment\n/, '') || null
  const touches = acts.filter(a => ['call', 'email', 'sms'].includes(a.type))
  const f = followUp(lead, acts)
  const history = touches.slice(0, 6).map(a => `- ${a.created_at.slice(0, 10)} ${a.type}: ${(a.body || '').slice(0, 140)}`).join('\n')
  const tags: string[] = lead.tags || []
  const how = lead.source_subtype === 'inquiry'
    ? `They sent us an inquiry asking for a quote${tags.includes('also:web_pixel') ? ' (and had browsed our website before that)' : ''}.`
    : lead.source_subtype === 'web_pixel'
      ? 'They visited our website but did not ask for anything. NEVER mention that we saw them on the site or tracked their visit.'
      : lead.source === 'apollo' ? 'Cold contact from our outbound list. They have not asked for anything.' : 'Existing contact.'
  const brief = parseBrief(acts.find(a => a.outcome === 'intake')?.body || '')
  return { inquiry, enrichment, touches, f, history, how, brief }
}

/** The one or two things we still need to quote, phrased as a question (from the qualifier's unanswered questions). */
function nextAsk(b: ReturnType<typeof parseBrief>) {
  const missing = (b.qa || []).filter(x => !x.a).map(x => x.q)
  const has = (re: RegExp) => missing.some(q => re.test(q))
  const asks: string[] = []
  if (has(/type of signage/i)) asks.push('what size you have in mind')
  if (has(/installed|deadline/i)) asks.push('when you need it by')
  if (has(/budget/i) && asks.length < 2) asks.push('whether you have a budget range or would like a couple of options')
  if (has(/logo|brand/i) && asks.length < 2) asks.push('whether your logo file is ready or you need design help')
  return asks.length ? asks.slice(0, 2).join(' and ') : null
}

/** The step this message is for, and the matching free template. */
function template(type: string, lead: Any, c: ReturnType<typeof context>, acts: Any[]) {
  const first = lead.first_name ? lead.first_name.charAt(0).toUpperCase() + lead.first_name.slice(1).toLowerCase() : 'there'
  const product = c.brief.product || c.inquiry?.match(/^\[([^\]]{3,60})\]/)?.[1] || null
  const need = product && !/^inquiry$/i.test(product) ? `your ${product.toLowerCase()} request` : c.inquiry ? 'your sign project' : null
  const cadence = cadenceFor(lead)
  let key = cadence?.key || (lead.source === 'apollo' ? 'web_pixel' : 'default')
  let idx = c.f && c.f.stepIndex >= 0 ? c.f.stepIndex : cadence ? stepsDone(cadence, cadenceTouches(lead, acts).counted) : c.touches.length
  if (key === 'default' && !need && c.touches.length === 0) { key = 'web_pixel'; idx = 0 }
  const industry = (c.enrichment?.match(/Industry: (.+)/) || [])[1] || null
  const t = stepTemplate(key, idx, { first, need, ask: nextAsk(c.brief), company: lead.company || null, industry })
  return { draft: type === 'sms' ? t.sms : t.email, subject: t.subject, step: t.step, of: t.of }
}

export async function POST(req: NextRequest) {
  try {
    const { type, lead: sent, leadId } = await req.json()
    const id = leadId || sent?.id
    if (!type || (!id && !sent)) return NextResponse.json({ error: 'Missing type or lead' }, { status: 400 })

    // Read the lead and its history from the database so the draft uses everything we know.
    let lead: Any = sent, acts: Any[] = []
    if (id) {
      const db = adminDb()
      const [l, a] = await Promise.all([
        db.from('leads').select('*').eq('id', id).single(),
        db.from('activities').select('type, body, outcome, created_at, lead_id').eq('lead_id', id).order('created_at', { ascending: false }).limit(40),
      ])
      if (l.data) lead = l.data
      acts = a.data || []
    }
    const c = context(lead, acts)
    const tpl = template(type, lead, c, acts)
    const stepNote = tpl.step <= tpl.of ? `Step ${tpl.step} of ${tpl.of} template` : 'Monthly check-in template'
    const fallback = (reason: string) => NextResponse.json({ draft: tpl.draft, subject: tpl.subject, fallback: true, reason: `${stepNote}. ${reason}` })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return fallback('The AI key is not configured, so this is the standard template.')

    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'unknown'
    const facts = [
      `Name: ${name}`,
      lead.company && `Company: ${lead.company}`,
      lead.title && `Title: ${lead.title}`,
      `How they came to us: ${c.how}`,
      c.inquiry && `What they asked for, in their words: "${c.inquiry}"`,
      c.enrichment && `Company research:\n${c.enrichment}`,
      c.brief.summary && `What our website assistant already learned from them: ${c.brief.summary}`,
      (c.brief.qa || []).some(x => !x.a) && `Still unknown (ask at most one of these): ${(c.brief.qa || []).filter(x => !x.a).map(x => x.q).join(' | ')}`,
      `Pipeline stage: ${lead.stage}`,
      lead.deal_value && `Quote value: $${lead.deal_value}`,
      c.history ? `Contact so far (newest first):\n${c.history}` : 'Contact so far: none. This is the first message.',
      c.f?.step && `This message is step ${c.f.stepIndex + 1} of ${c.f.cadence.steps.length} in our follow-up sequence: "${c.f.step.title}". Guidance: ${c.f.step.script}`,
    ].filter(Boolean).join('\n')

    const rules = `Rules:
- Use only the facts given. Never invent prices, past conversations, or details about their business.
- Refer to something specific: what they asked for, or their industry and what signage a business like theirs typically needs.
- One clear ask. Plain, friendly, no hype words, no exclamation marks, no "I hope this finds you well".
- Do not repeat a message already sent; move the conversation forward.`

    const userPrompt = type === 'sms'
      ? `${facts}\n\n${rules}\n\nWrite one SMS under 300 characters from Signarama Corona. Start with "Hi <first name>,". No links, no emojis. Output only the message.`
      : `${facts}\n\n${rules}\n\nWrite the body of a short email (60 to 110 words) from Signarama Corona. Start with "Hi <first name>,". No subject line and no signature. Output only the body.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 400,
        system: `You write outreach for a sales rep at a local sign shop.\n${SHOP}`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic API error:', response.status, err)
      const billing = /credit balance|billing/i.test(err)
      return fallback(billing
        ? 'Written for this follow-up step; check it before sending. (AI drafting is off until the Anthropic API account has credit.)'
        : `The AI service returned an error (${response.status}), so this is the standard template.`)
    }

    const data = await response.json()
    const draft = data.content?.[0]?.text?.trim() || ''
    return draft ? NextResponse.json({ draft, subject: tpl.subject, usedEnrichment: !!c.enrichment }) : fallback('The AI returned nothing, so this is the standard template.')
  } catch (err) {
    console.error('AI draft error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
