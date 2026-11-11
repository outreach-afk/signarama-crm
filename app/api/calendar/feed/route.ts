import { NextRequest, NextResponse } from 'next/server'
import { adminDb, calendarToken } from '@/lib/sync'
import { fetchAllLeads, fullName } from '@/lib/leads'
import { followUp, groupTouches, urgency, type FollowUp, type TouchLike } from '@/lib/cadence'

export const maxDuration = 30

// Subscribable calendar (.ics): one all-day entry per day listing the follow-ups due,
// instead of one event per lead, so it does not bury the rest of the calendar.
// Auth: ?key=<token from /api/calendar/link>. Exempt from the login middleware.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== calendarToken()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = adminDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leads = (await fetchAllLeads<any>(db, 'id, created_at, stage, source, source_subtype, next_step, next_step_due, first_name, last_name, email, company, phone'))
    .filter(l => l.source !== 'apollo')
  const acts: TouchLike[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('activities').select('lead_id, type, created_at, outcome')
      .in('type', ['call', 'email', 'sms', 'stage_change']).range(from, from + 999)
    acts.push(...((data || []) as TouchLike[]))
    if (!data || data.length < 1000) break
  }
  const by = groupTouches(acts)

  // Days are computed in Pacific time (the shop's time zone).
  const dayOf = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms))
  const now = Date.now()
  const today = dayOf(now)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days = new Map<string, { l: any; f: FollowUp }[]>()
  for (const l of leads) {
    const f = followUp(l, by.get(l.id) || [], now)
    if (!f || !f.dueAt || f.state === 'backlog') continue
    const d = f.state === 'overdue' ? today : dayOf(f.dueAt)
    if (d < today) continue
    const arr = days.get(d); if (arr) arr.push({ l, f }); else days.set(d, [{ l, f }])
  }

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Signarama Corona CRM//Follow-ups//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Signarama follow-ups', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H']
  for (const [d, items] of [...days.entries()].sort().slice(0, 30)) {
    items.sort((a, b) => urgency(b.l, b.f) - urgency(a.l, a.f))
    const late = d === today ? items.filter(x => x.f.state === 'overdue').length : 0
    const next = new Date(`${d}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    const body = items.slice(0, 30).map(({ l, f }) =>
      `• ${fullName(l)}${l.company ? ` (${l.company})` : ''} — ${f.label}${l.phone ? ` — ${l.phone}` : ''}`).join('\n')
      + (items.length > 30 ? `\n…and ${items.length - 30} more` : '') + '\n\nOpen the list: https://signarama-crm.vercel.app/today'
    lines.push('BEGIN:VEVENT', `UID:followups-${d}@signarama-crm`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${esc(`${items.length} follow-up${items.length === 1 ? '' : 's'}${late ? ` (${late} overdue)` : ''} — Signarama CRM`)}`,
      `DESCRIPTION:${esc(body)}`, 'URL:https://signarama-crm.vercel.app/today', 'TRANSP:TRANSPARENT', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return new NextResponse(lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
