// Follow-up SOP as code. One source of truth for the Today queue, the lead page,
// the calendar and the calendar feed. Edit the cadences here and everything follows.

export type TouchType = 'call' | 'email' | 'sms'
export type Step = { gap: number; do: TouchType[]; title: string; script: string }
export type Cadence = { key: string; name: string; goal: string; steps: Step[] }

const DAY = 86_400_000

// `gap` = days to wait after the previous touch (or after the lead arrived, for step 1).
export const CADENCES: Record<string, Cadence> = {
  inquiry: {
    key: 'inquiry',
    name: 'Inquiry — 8 touches in 14 days',
    goal: 'They asked for a quote. Reach a human the same day and get the details needed to quote.',
    steps: [
      { gap: 0, do: ['call', 'email'], title: 'Call now, then email', script: 'Call within 5 minutes if you can, within the hour at worst. "Hi {first}, this is {rep} at Signarama Corona — you just asked about {need}. Do you have two minutes so I can get you an accurate price?" No answer: leave a 20-second voicemail and send the email straight away.' },
      { gap: 0, do: ['sms'], title: 'Text if no answer', script: '"Hi {first}, {rep} from Signarama Corona. Got your request for {need} — I just tried calling. When is a good time for a quick call, or would you rather I email the quote?"' },
      { gap: 1, do: ['call'], title: 'Second call, different time of day', script: 'If you called in the morning, call mid-afternoon (4–5 pm is the best window). No voicemail this time.' },
      { gap: 1, do: ['email'], title: 'Email with one useful thing', script: 'Send a photo of a similar job, a rough price range, or the one question that unblocks the quote (size? install? deadline?). One ask only.' },
      { gap: 2, do: ['call', 'sms'], title: 'Call + text', script: 'Call. If no answer, text: "Still happy to help with {need}. Want me to send a ballpark so you have it?"' },
      { gap: 3, do: ['email'], title: 'Proof email', script: 'Short email with a before/after or a local customer example in their industry. "Thought this might be close to what you had in mind."' },
      { gap: 3, do: ['call'], title: 'Last call', script: 'Final call attempt. Leave a voicemail saying you will send one last note.' },
      { gap: 4, do: ['email'], title: 'Close-the-file email', script: '"I have not been able to reach you, so I will close this request for now. If the project is still on, reply here and I will pick it straight back up." This one gets the most replies.' },
    ],
  },
  web_pixel: {
    key: 'web_pixel',
    name: 'Web Pixel — 5 touches in 14 days',
    goal: 'They looked at the website but did not ask for anything. Be helpful, not creepy: never say you saw them on the site.',
    steps: [
      { gap: 0, do: ['email'], title: 'Intro email', script: 'Revscale already sends the first email. If they have a business email or a company, send a short personal one: who you are, one line on what Signarama Corona does for businesses like theirs, one question.' },
      { gap: 2, do: ['call'], title: 'Call if there is a number', script: '"Hi {first}, {rep} at Signarama Corona here in Corona. We help local businesses with signs, banners and vehicle graphics — is there a project coming up I can price for you?" No number: send a second email instead.' },
      { gap: 3, do: ['email'], title: 'Example email', script: 'One photo of a relevant job plus a price range. Ask a yes/no question.' },
      { gap: 4, do: ['sms', 'call'], title: 'Text or call', script: 'Short text if you have a mobile number, otherwise a call. Opened our email? That is the signal to call.' },
      { gap: 5, do: ['email'], title: 'Last email', script: '"No project right now? No problem — keep my number for when one comes up." Then move to monthly nurture.' },
    ],
  },
  quoted: {
    key: 'quoted',
    name: 'Quote sent — 5 touches in 21 days',
    goal: 'A quote that is not followed up is a lost job. Most quotes close on the 2nd–4th follow-up.',
    steps: [
      { gap: 1, do: ['call'], title: 'Confirm they got it', script: '"Just checking the quote came through and answers what you needed. Anything you want changed?"' },
      { gap: 2, do: ['email'], title: 'Answer the likely objection', script: 'Price, timing or design — pick the one you think is holding it up and address it. Offer one alternative option.' },
      { gap: 3, do: ['call', 'sms'], title: 'Call + text', script: 'Ask for the decision date. "When are you looking to have this installed?" Work backwards from that date.' },
      { gap: 5, do: ['email'], title: 'Deadline nudge', script: 'Mention production lead time: "To have it up by {date} we would need to start by {date}."' },
      { gap: 10, do: ['call'], title: 'Final check', script: 'Ask directly whether the project is still going ahead. If not, ask what changed and mark it lost with the reason.' },
    ],
  },
  default: {
    key: 'default',
    name: 'Working lead — 4 touches in 14 days',
    goal: 'Keep the conversation moving until there is a quote or a clear no.',
    steps: [
      { gap: 1, do: ['call'], title: 'Call', script: 'Move it forward: what do you need from them to quote?' },
      { gap: 3, do: ['email'], title: 'Email', script: 'Recap where things stand and the one next step.' },
      { gap: 4, do: ['call', 'sms'], title: 'Call + text', script: 'Try a different time of day.' },
      { gap: 6, do: ['email'], title: 'Close-the-file email', script: 'Offer to close the request unless they reply.' },
    ],
  },
}

export const NURTURE_DAYS = 30
export const FRESH_DAYS = 30 // an untouched lead older than this is backlog, not an overdue task

export type TouchLike = { lead_id: string; type: string; created_at: string; outcome?: string | null }
export type LeadLike = {
  id: string; created_at: string; stage: string; source: string
  source_subtype?: string | null; next_step?: string | null; next_step_due?: string | null
}

export type FollowUp = {
  cadence: Cadence
  touches: number
  last: Partial<Record<TouchType, string>> // ISO date of the last call / email / sms
  lastTouchAt: string | null
  stepIndex: number // 0-based; === steps.length means the cadence is finished
  step: Step | null
  dueAt: number | null // ms
  state: 'closed' | 'manual' | 'due' | 'overdue' | 'upcoming' | 'nurture' | 'backlog'
  label: string
  daysOverdue: number
}

export function cadenceFor(l: LeadLike): Cadence | null {
  if (['won', 'completed', 'lost'].includes(l.stage)) return null
  if (l.stage === 'quoted' || l.stage === 'negotiating') return CADENCES.quoted
  if (l.source_subtype === 'inquiry') return CADENCES.inquiry
  if (l.source_subtype === 'web_pixel') return CADENCES.web_pixel
  if (l.stage === 'contacted') return CADENCES.default
  return null // cold leads are worked in Apollo / Revscale, not here
}

const isTouch = (t: string): t is TouchType => t === 'call' || t === 'email' || t === 'sms'
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export function followUp(l: LeadLike, acts: TouchLike[], now = Date.now()): FollowUp | null {
  const cadence = cadenceFor(l)
  const mine = acts.filter(a => isTouch(a.type)).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const last: FollowUp['last'] = {}
  for (const a of mine) last[a.type as TouchType] = a.created_at
  const lastTouchAt = mine.length ? mine[mine.length - 1].created_at : null
  if (!cadence) return null

  const base = { cadence, touches: mine.length, last, lastTouchAt }
  const created = new Date(l.created_at).getTime()

  // A date someone set by hand always wins over the cadence.
  if (l.next_step_due) {
    const due = new Date(l.next_step_due).getTime()
    const od = Math.floor((startOfDay(now) - startOfDay(due)) / DAY)
    return {
      ...base, stepIndex: -1, step: null, dueAt: due, state: od > 0 ? 'overdue' : od === 0 ? 'due' : 'manual',
      label: l.next_step || 'Scheduled follow-up', daysOverdue: Math.max(0, od),
    }
  }

  // Quote cadence counts touches made since the lead was last touched before quoting — keep it simple:
  // steps advance with every logged touch; a stage change to quoted restarts at step 1.
  const stageStart = l.stage === 'quoted' || l.stage === 'negotiating'
    ? acts.filter(a => a.type === 'stage_change').map(a => a.created_at).sort().pop() || null : null
  const counted = stageStart ? mine.filter(a => a.created_at >= stageStart) : mine
  const anchor = counted.length ? new Date(counted[counted.length - 1].created_at).getTime()
    : stageStart ? new Date(stageStart).getTime() : created
  const i = counted.length

  if (!counted.length && !stageStart && now - created > FRESH_DAYS * DAY) {
    return { ...base, stepIndex: 0, step: cadence.steps[0], dueAt: null, state: 'backlog', label: 'Never contacted — re-engage or close', daysOverdue: 0 }
  }

  if (i >= cadence.steps.length) {
    const due = anchor + NURTURE_DAYS * DAY
    const od = Math.floor((startOfDay(now) - startOfDay(due)) / DAY)
    return { ...base, stepIndex: i, step: null, dueAt: due, state: od >= 0 ? 'due' : 'nurture', label: 'Monthly check-in', daysOverdue: Math.max(0, od) }
  }

  const step = cadence.steps[i]
  const due = anchor + step.gap * DAY
  const od = Math.floor((startOfDay(now) - startOfDay(due)) / DAY)
  return {
    ...base, stepIndex: i, step, dueAt: due,
    state: od > 0 ? 'overdue' : od === 0 ? 'due' : 'upcoming',
    label: step.title, daysOverdue: Math.max(0, od),
  }
}

export function groupTouches<T extends TouchLike>(acts: T[]) {
  const m = new Map<string, T[]>()
  for (const a of acts) { const arr = m.get(a.lead_id); if (arr) arr.push(a); else m.set(a.lead_id, [a]) }
  return m
}

/** Higher = work it first. Inquiries beat everything; step 1 beats later steps. */
export function urgency(l: LeadLike, f: FollowUp) {
  let s = 0
  if (f.state === 'overdue') s += 40 + Math.min(f.daysOverdue, 10)
  if (f.state === 'due') s += 30
  if (l.source_subtype === 'inquiry') s += 25
  if (l.stage === 'quoted' || l.stage === 'negotiating') s += 20
  if (f.stepIndex === 0) s += 15
  return s
}
