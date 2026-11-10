'use client'

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Stage } from '@/types/database'
import { CHANNELS, fetchAllLeads, leadChannel, type Channel } from '@/lib/leads'

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
  if (ch) { const c = CHANNELS[ch as Channel]; return <Pill color={c.color} title={c.hint}>{c.icon} {c.label}</Pill> }
  if (lead.source === 'apollo') return <Pill color="#F59E0B">🚀 Apollo</Pill>
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

export const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }
export const h1: React.CSSProperties = { fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 4 }
export const sub: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 14, maxWidth: 680 }
