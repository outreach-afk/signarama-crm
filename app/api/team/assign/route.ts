import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/sync'
import { cadenceFor, cadenceTouches, stepsDone, type TouchLike } from '@/lib/cadence'
import { DEFAULT_TEAM, TEAM_KEY, type TeamSettings } from '@/lib/team'

export const maxDuration = 60

// Logged-in users only (middleware). Gives an owner to every open warm lead that has none.
// Inquiry: the closer if quoted or already past the handoff step, otherwise the opener.
// Web Pixel: always the closer (also moves pixel leads still sitting with the opener).
export async function POST() {
  const db = adminDb()
  const { data: row } = await db.from('app_settings').select('value').eq('key', TEAM_KEY).maybeSingle()
  const team: TeamSettings = { ...DEFAULT_TEAM, ...((row?.value as Partial<TeamSettings>) || {}) }
  if (!team.opener || !team.closer) return NextResponse.json({ error: 'Choose the opener and the closer first, then save.' }, { status: 400 })

  const { data: leads, error } = await db.from('leads')
    .select('id, stage, source, source_subtype, created_at, next_step_due, assigned_to')
    .eq('source', 'revscale').in('source_subtype', ['web_pixel', 'inquiry'])
    .not('stage', 'in', '(won,completed,lost,unqualified)').or(`assigned_to.is.null,and(source_subtype.eq.web_pixel,assigned_to.eq.${team.opener})`).limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!leads?.length) return NextResponse.json({ opener: 0, closer: 0, message: 'Every open warm lead already has an owner.' })

  const acts: TouchLike[] = []
  const ids = leads.map(l => l.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('activities').select('lead_id, type, created_at, outcome')
      .in('lead_id', ids.slice(i, i + 200)).in('type', ['call', 'email', 'sms', 'stage_change'])
    acts.push(...((data || []) as TouchLike[]))
  }
  const by = new Map<string, TouchLike[]>()
  for (const a of acts) { const arr = by.get(a.lead_id); if (arr) arr.push(a); else by.set(a.lead_id, [a]) }

  const toOpener: string[] = [], toCloser: string[] = []
  for (const l of leads) {
    const c = cadenceFor(l)
    const past = c && c.key === 'inquiry' && stepsDone(c, cadenceTouches(l, by.get(l.id) || []).counted) >= team.handoffStep
    if (l.source_subtype === 'web_pixel' || l.stage === 'quoted' || l.stage === 'negotiating' || past) toCloser.push(l.id); else toOpener.push(l.id)
  }
  for (const [owner, list] of [[team.opener, toOpener], [team.closer, toCloser]] as const) {
    for (let i = 0; i < list.length; i += 200) {
      const { error: e } = await db.from('leads').update({ assigned_to: owner }).in('id', list.slice(i, i + 200))
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }
  return NextResponse.json({ opener: toOpener.length, closer: toCloser.length })
}
