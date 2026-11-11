'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Stage } from '@/types/database'
import { CHANNELS, alsoPixel, fetchAllLeads, leadChannel, type Channel } from '@/lib/leads'
import { followUp, groupTouches, type FollowUp, type TouchLike, type TouchType } from '@/lib/cadence'

export const STAGES: Stage[] = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'completed', 'lost']
export const STAGE_COLOR: Record<string, string> = {
  new: '#94A3B8', contacted: '#60A5FA', quoted: '#A78BFA',
  negotiating: '#FCD34D', won: '#34D399', completed: '#6EE7B7', lost: '#F87171',
}

export const isWarm = (l: Lead) => l.source === 'revscale' && ['web_pixel', 'inquiry'].includes(l.source_subtype || '')
export const hasTag = (l: Lead, t: string) => (l.tags || []).includes(t)

export function Pill({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, background: `${color}1c`, color, border: `1px solid ${color}33`,
      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export function ChannelPill({ lead }: { lead: Lead }) {
  const ch = leadChannel(lead)
  if (ch) {
    const c = CHANNELS[ch as Channel]
    return (
      <>
        <Pill color={c.color} title={c.hint}>{c.icon} {c.label}</Pill>
        {alsoPixel(lead) && <Pill color={CHANNELS.web_pixel.color} title="Same person was also identified on the website by the pixel. One lead, not two.">+ visited site</Pill>}
      </>
    )
  }
  if (lead.source === 'apollo') return <Pill color="#F59E0B">● Apollo</Pill>
  return <Pill color="#64748B">{lead.source.replace('_', ' ')}</Pill>
}

/** One shared, realtime-refreshed copy of every lead, plus optimistic updates. */
export function useLeads() {
  const supabase = useMemo(() => createClient(), [])
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['leads'], queryFn: () => fetchAllLeads<Lead>(supabase) })

  useEffect(() => {
    const ch = supabase.channel(`leads-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => qc.invalidateQueries({ queryKey: ['leads'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, qc])

  async function patch(lead: Lead, changes: Partial<Lead>, note?: string) {
    qc.setQueryData<Lead[]>(['leads'], old => (old || []).map(l => (l.id === lead.id ? { ...l, ...changes } : l)))
    const { error } = await supabase.from('leads').update(changes as never).eq('id', lead.id)
    if (error) { qc.invalidateQueries({ queryKey: ['leads'] }); return false }
    if (note) await supabase.from('activities').insert([{ lead_id: lead.id, type: 'stage_change', body: note }] as never)
    return true
  }
  const setStage = (lead: Lead, stage: Stage) =>
    lead.stage === stage ? Promise.resolve(true) : patch(lead, { stage }, `Stage changed from ${lead.stage} → ${stage}`)

  return { leads: query.data || [], isLoading: query.isLoading, patch, setStage }
}

export const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)' }
export const h1: React.CSSProperties = { fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 27, fontWeight: 700, marginBottom: 4, letterSpacing: '-0.02em' }
export const sub: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 14, maxWidth: 680 }

/** Every logged call / email / SMS, grouped by lead, with the follow-up state worked out per lead. */
export function useFollowUps(leads: Lead[]) {
  const supabase = useMemo(() => createClient(), [])
  const qc = useQueryClient()
  const { data: acts = [] } = useQuery({
    queryKey: ['touches'],
    queryFn: async () => {
      const out: TouchLike[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('activities').select('lead_id, type, created_at, outcome')
          .in('type', ['call', 'email', 'sms', 'stage_change']).order('created_at').range(from, from + 999)
        if (error) throw error
        out.push(...(data as TouchLike[]))
        if (!data || data.length < 1000) break
      }
      return out
    },
  })

  useEffect(() => {
    const ch = supabase.channel(`touches-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, () => qc.invalidateQueries({ queryKey: ['touches'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, qc])

  const map = useMemo(() => {
    const by = groupTouches(acts)
    const now = Date.now()
    const m = new Map<string, FollowUp>()
    for (const l of leads) { const f = followUp(l, by.get(l.id) || [], now); if (f) m.set(l.id, f) }
    return m
  }, [acts, leads])

  /** Record a touch made outside the CRM (a phone call, an email from Gmail, a text from a mobile). */
  async function logTouch(lead: Lead, type: TouchType, outcome: string, note?: string) {
    const body = [`${type === 'call' ? 'Call' : type === 'email' ? 'Email' : 'SMS'} — ${outcome}`, note].filter(Boolean).join('. ')
    qc.setQueryData<TouchLike[]>(['touches'], old => [...(old || []), { lead_id: lead.id, type, created_at: new Date().toISOString(), outcome }])
    const { error } = await supabase.from('activities').insert([{ lead_id: lead.id, type, body, outcome }] as never)
    if (error) { qc.invalidateQueries({ queryKey: ['touches'] }); return false }
    qc.invalidateQueries({ queryKey: ['activities', lead.id] })
    // First touch moves a new lead to "contacted"; a manual reminder is used up by the touch.
    const changes: Partial<Lead> = {}
    if (lead.stage === 'new') changes.stage = 'contacted'
    if (lead.next_step_due) { changes.next_step_due = null; changes.next_step = null }
    if (Object.keys(changes).length) {
      qc.setQueryData<Lead[]>(['leads'], old => (old || []).map(l => (l.id === lead.id ? { ...l, ...changes } : l)))
      await supabase.from('leads').update(changes as never).eq('id', lead.id)
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
    }
    return true
  }

  return { followUps: map, logTouch }
}

export const CALL_OUTCOMES = ['Spoke with them', 'Left voicemail', 'No answer', 'Wrong number']

/** Three small buttons that log a call / email / SMS in one or two clicks. */
export function LogTouch({ onLog, compact }: { onLog: (type: TouchType, outcome: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const b = (color: string): React.CSSProperties => ({
    padding: compact ? '5px 9px' : '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    background: `${color}18`, color, border: `1px solid ${color}40`,
  })
  return (
    <span style={{ position: 'relative', display: 'inline-flex', gap: 6 }}>
      <button style={b('#10B981')} onClick={() => setOpen(o => !o)} title="Log a call you made">Log call ▾</button>
      <button style={b('#3B82F6')} onClick={() => onLog('email', 'Sent')} title="Log an email you sent outside the CRM">Log email</button>
      <button style={b('#8B5CF6')} onClick={() => onLog('sms', 'Sent')} title="Log a text you sent outside the CRM">Log SMS</button>
      {open && (
        <span style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: 4, display: 'flex', flexDirection: 'column', minWidth: 160, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}>
          {CALL_OUTCOMES.map(o => (
            <button key={o} onClick={() => { setOpen(false); onLog('call', o) }}
              style={{ textAlign: 'left', padding: '7px 10px', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{o}</button>
          ))}
        </span>
      )}
    </span>
  )
}

export function dueText(f: FollowUp) {
  if (f.state === 'backlog') return 'Never contacted'
  if (!f.dueAt) return ''
  if (f.state === 'overdue') return `${f.daysOverdue}d overdue`
  if (f.state === 'due') return 'Due today'
  const days = Math.ceil((f.dueAt - Date.now()) / 86_400_000)
  return days <= 1 ? 'Due tomorrow' : `Due in ${days}d`
}
export const DUE_COLOR: Record<FollowUp['state'], string> = {
  overdue: '#EF4444', due: '#F59E0B', upcoming: '#64748B', manual: '#64748B', nurture: '#64748B', backlog: '#94A3B8', closed: '#64748B',
}
