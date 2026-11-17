// Who works which part of the follow-up. Stored in app_settings under key 'followup_team'.
export type TeamSettings = {
  opener: string | null      // profile id: makes first contact and works steps 1..handoffStep
  closer: string | null      // profile id: takes over after the handoff
  handoffStep: number        // hand off once this many steps are done
  handoffOnEngage: boolean   // also hand off as soon as the lead engages (spoke with them, or moved to Quoted)
}
export const TEAM_KEY = 'followup_team'
export const DEFAULT_TEAM: TeamSettings = { opener: null, closer: null, handoffStep: 5, handoffOnEngage: false }

export type Profile = { id: string; full_name: string | null; email: string | null; role: string }

export function displayName(p: Profile | null | undefined) {
  if (!p) return 'Unassigned'
  if (p.full_name) return p.full_name.split(' ')[0]
  const local = (p.email || '').split('@')[0]
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Someone'
}
export function initials(p: Profile | null | undefined) {
  if (!p) return '—'
  const src = p.full_name || (p.email || '').split('@')[0]
  return src.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('') || '?'
}

/** Only Inquiry leads go through the opener → closer handoff. Web Pixel leads belong to the closer from the start. */
export const HANDOFF_CHANNELS = ['inquiry']
export function ownerForNewLead(channel: string | null | undefined, team: Pick<TeamSettings, 'opener' | 'closer'>) {
  if (channel === 'inquiry') return team.opener || null
  if (channel === 'web_pixel') return team.closer || null
  return null
}
