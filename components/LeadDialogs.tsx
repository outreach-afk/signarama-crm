'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, ArrowRightLeft, Phone, Mail, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/types/database'
import { CLOSE_REASONS, fullName } from '@/lib/leads'
import { useTeam, type CloseRequest, type HandoffRequest } from '@/components/LeadBits'

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(4,6,12,0.62)', backdropFilter: 'blur(5px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}
const panel: React.CSSProperties = {
  width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', borderRadius: 16, padding: 24,
  background: '#141925', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-raised)',
}
const textarea: React.CSSProperties = {
  width: '100%', padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit',
}
const btn = (primary: boolean, color = 'var(--primary)'): React.CSSProperties => ({
  padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  background: primary ? color : 'transparent', color: primary ? '#fff' : 'var(--text-secondary)',
  border: primary ? 'none' : '1px solid var(--border)',
})

/** Mounted once in the dashboard layout. Listens for close and handoff requests from any page. */
export default function LeadDialogs() {
  const [close, setClose] = useState<CloseRequest | null>(null)
  const [handoff, setHandoff] = useState<HandoffRequest | null>(null)
  useEffect(() => {
    const c = (e: Event) => setClose((e as CustomEvent<CloseRequest>).detail)
    const h = (e: Event) => setHandoff((e as CustomEvent<HandoffRequest>).detail)
    window.addEventListener('crm:close-lead', c); window.addEventListener('crm:handoff-lead', h)
    return () => { window.removeEventListener('crm:close-lead', c); window.removeEventListener('crm:handoff-lead', h) }
  }, [])
  return (
    <>
      {close && <CloseDialog key={close.lead.id + close.stage} req={close} done={() => setClose(null)} />}
      {handoff && !close && <HandoffDialog key={handoff.lead.id} req={handoff} done={() => setHandoff(null)} />}
    </>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return (id: string) => {
    for (const k of [['leads'], ['lead', id], ['activities', id], ['touches']]) qc.invalidateQueries({ queryKey: k })
  }
}

function CloseDialog({ req, done }: { req: CloseRequest; done: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const qc = useQueryClient()
  const refresh = useRefresh()
  const { lead, stage } = req
  const reasons = CLOSE_REASONS[stage]
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const needsNote = reason === 'Other'
  const lost = stage === 'lost'

  async function save() {
    if (!reason || (needsNote && !note.trim())) return
    setSaving(true); setError('')
    const value = needsNote ? `Other: ${note.trim()}` : reason
    const changes: Partial<Lead> = { stage, lost_reason: value, next_step: null, next_step_due: null }
    qc.setQueryData<Lead[]>(['leads'], old => (old || []).map(l => (l.id === lead.id ? { ...l, ...changes } : l)))
    const { error } = await supabase.from('leads').update(changes as never).eq('id', lead.id)
    if (error) { setError(error.message); setSaving(false); refresh(lead.id); return }
    const body = `Marked ${lost ? 'lost' : 'unqualified'} — ${value}${!needsNote && note.trim() ? `. ${note.trim()}` : ''}`
    await supabase.from('activities').insert([{ lead_id: lead.id, type: 'stage_change', body, outcome: stage }] as never)
    refresh(lead.id)
    done()
  }

  return (
    <div style={overlay} onClick={done}>
      <div style={panel} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') done() }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{lost ? 'Mark as lost' : 'Mark as unqualified'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
              {fullName(lead)}{lead.company ? ` · ${lead.company}` : ''}
            </div>
          </div>
          <button onClick={done} className="icon-btn" aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '12px 0 14px' }}>
          {lost
            ? 'A real opportunity we did not win. The reason feeds the Reports page so we can see why jobs are lost.'
            : 'Never a real opportunity. Kept apart from lost so junk inquiries do not drag down the close rate.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reasons.map(r => {
            const on = reason === r.label
            return (
              <button key={r.label} onClick={() => setReason(r.label)} style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                background: on ? 'var(--primary-dim)' : 'var(--surface-2)', color: 'var(--text)',
                border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 99, flexShrink: 0, border: `2px solid ${on ? 'var(--primary)' : 'var(--border-strong)'}`, background: on ? 'var(--primary)' : 'transparent', boxShadow: on ? 'inset 0 0 0 2px #141925' : 'none' }} />
                  <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 500 }}>{r.label}</span>
                </div>
                {r.hint && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, paddingLeft: 24 }}>{r.hint}</div>}
              </button>
            )
          })}
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...textarea, marginTop: 12 }}
          placeholder={needsNote ? 'What was the reason? (required)' : 'Anything worth remembering (optional)'} />
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={done} style={btn(false)}>Cancel</button>
          <button onClick={save} disabled={!reason || (needsNote && !note.trim()) || saving} style={btn(true, lost ? '#DC2626' : '#78716C')}>
            {saving ? 'Saving…' : lost ? 'Mark as lost' : 'Mark as unqualified'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HandoffDialog({ req, done }: { req: HandoffRequest; done: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const qc = useQueryClient()
  const refresh = useRefresh()
  const team = useTeam()
  const { lead, reason, auto } = req
  const closer = team.settings.closer
  const closerName = team.name(closer)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [touches, setTouches] = useState<{ type: string; outcome: string | null; created_at: string; user_id: string | null }[]>([])

  useEffect(() => {
    supabase.from('activities').select('type, outcome, created_at, user_id').eq('lead_id', lead.id)
      .in('type', ['call', 'email', 'sms']).order('created_at')
      .then(({ data }) => setTouches((data || []) as typeof touches))
  }, [supabase, lead.id])

  const count = (t: string) => touches.filter(x => x.type === t).length
  const lastCall = [...touches].reverse().find(t => t.type === 'call')
  const summary = `${count('call')} call${count('call') === 1 ? '' : 's'}, ${count('email')} email${count('email') === 1 ? '' : 's'}, ${count('sms')} text${count('sms') === 1 ? '' : 's'}`
    + (lastCall?.outcome ? ` · last call: ${lastCall.outcome}` : '')

  async function save() {
    if (!closer) return
    setSaving(true); setError('')
    const tags = Array.from(new Set([...(lead.tags || []), 'handoff_new']))
    const changes: Partial<Lead> = { assigned_to: closer, tags }
    qc.setQueryData<Lead[]>(['leads'], old => (old || []).map(l => (l.id === lead.id ? { ...l, ...changes } : l)))
    const { error } = await supabase.from('leads').update(changes as never).eq('id', lead.id)
    if (error) { setError(error.message); setSaving(false); refresh(lead.id); return }
    const from = team.name(team.me)
    const body = `${from} handed this lead to ${closerName} (${reason}).\nDone so far: ${summary}.${note.trim() ? `\n\n${note.trim()}` : ''}`
    await supabase.from('activities').insert([{ lead_id: lead.id, type: 'handoff', body, outcome: 'handoff' }] as never)
    refresh(lead.id)
    done()
  }

  if (!closer) return null
  return (
    <div style={overlay} onClick={done}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.16)', color: '#F59E0B' }}><ArrowRightLeft size={18} /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Hand off to {closerName}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{fullName(lead)}{lead.company ? ` · ${lead.company}` : ''}</div>
            </div>
          </div>
          <button onClick={done} className="icon-btn" aria-label="Close"><X size={16} /></button>
        </div>

        <div style={{ margin: '16px 0 12px', padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{auto ? `${reason}. Per the team process this lead now moves to ${closerName}.` : 'Done so far'}</div>
          <div style={{ display: 'flex', gap: 14, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Phone size={13} color="#10B981" /> {count('call')}</span>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Mail size={13} color="#3B82F6" /> {count('email')}</span>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><MessageSquare size={13} color="#8B5CF6" /> {count('sms')}</span>
            {lastCall?.outcome && <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>Last call: {lastCall.outcome}</span>}
          </div>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Handoff note for {closerName}</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} autoFocus style={{ ...textarea, marginTop: 6 }}
          placeholder="What they need, size or quantity, deadline, budget, best time to reach them, anything they already told us." />
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>Two lines here save {closerName} from asking the customer the same questions again.</p>
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={done} style={btn(false)}>{auto ? 'Keep it for now' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} style={btn(true, '#D97706')}>{saving ? 'Handing off…' : `Hand off to ${closerName}`}</button>
        </div>
      </div>
    </div>
  )
}
