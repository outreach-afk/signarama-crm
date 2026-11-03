'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Activity, Stage } from '@/types/database'

const STAGES: Stage[] = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'completed', 'lost']
const STAGE_COLOR: Record<string, string> = {
  new: '#94A3B8', contacted: '#60A5FA', quoted: '#A78BFA',
  negotiating: '#FCD34D', won: '#34D399', completed: '#6EE7B7', lost: '#F87171',
}

function fullName(l: Lead) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email || '(no name)'
}

function timeSince(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const ACTIVITY_ICONS: Record<string, string> = {
  call: '📞', email: '✉️', sms: '💬', note: '📝', stage_change: '🔄', visit: '🏢',
}

export default function LeadDetailClient() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const qc = useQueryClient()

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('*').eq('id', id).single()
      if (error) throw error
      return data as Lead
    },
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['activities', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('activities').select('*').eq('lead_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data as Activity[]
    },
    enabled: !!id,
  })

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`lead-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ['lead', id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `lead_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ['activities', id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, supabase, qc])

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Lead>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (lead) setEditForm(lead) }, [lead])

  async function saveLead() {
    if (!lead) return
    setSaving(true)
    const { error } = await supabase.from('leads').update(editForm as never).eq('id', id)
    if (!error) {
      qc.invalidateQueries({ queryKey: ['lead', id] })
      setEditing(false)
      // Log stage change if applicable
      if (editForm.stage !== lead.stage) {
        await supabase.from('activities').insert([{
          lead_id: id, type: 'stage_change',
          body: `Stage changed from ${lead.stage} → ${editForm.stage}`,
        }] as never)
      }
    }
    setSaving(false)
  }

  async function deleteLead() {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    await supabase.from('leads').delete().eq('id', id)
    router.push('/leads')
  }

  // Modals
  const [modal, setModal] = useState<'sms' | 'email' | 'note' | null>(null)
  const [modalBody, setModalBody] = useState('')
  const [modalSubject, setModalSubject] = useState('')
  const [modalSending, setModalSending] = useState(false)
  const [modalMsg, setModalMsg] = useState('')

  const openModal = useCallback((m: 'sms' | 'email' | 'note') => {
    setModal(m)
    setModalBody('')
    setModalSubject(m === 'email' ? `Follow up — ${lead?.company || ''}`.trim() : '')
    setModalMsg('')
  }, [lead])

  async function sendModal() {
    if (!modal || !modalBody.trim()) return
    setModalSending(true)
    try {
      if (modal === 'note') {
        await supabase.from('activities').insert([{ lead_id: id, type: 'note', body: modalBody }] as never)
        qc.invalidateQueries({ queryKey: ['activities', id] })
        setModal(null)
        return
      }
      const endpoint = modal === 'sms' ? '/api/sms/send' : '/api/email/send'
      const body = modal === 'sms'
        ? { leadId: id, to: lead?.phone, body: modalBody }
        : { leadId: id, to: lead?.email, subject: modalSubject, body: modalBody }
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Failed')
      setModalMsg('✓ Sent!')
      qc.invalidateQueries({ queryKey: ['activities', id] })
      setTimeout(() => setModal(null), 1200)
    } catch {
      setModalMsg('✗ Failed. Check your connection settings.')
    } finally {
      setModalSending(false)
    }
  }

  if (isLoading) return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Loading…</div>
  if (!lead) return <div style={{ padding: 40, color: 'var(--danger)' }}>Lead not found.</div>

  const field = (label: string, key: keyof Lead, type = 'text', opts?: string[]) => {
    const val = editForm[key] as string ?? ''
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        {editing ? (
          opts ? (
            <select value={val} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
              style={{ padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }}>
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input type={type} value={val} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
              style={{ padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
          )
        ) : (
          <span style={{ fontSize: 13, color: (lead[key] as string) ? 'var(--text)' : 'var(--text-muted)', padding: '7px 0' }}>
            {(lead[key] as string) || '—'}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '32px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }}>
          ← Back
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{fullName(lead)}</h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {lead.company && <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{lead.company}</span>}
              {lead.title && <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>· {lead.title}</span>}
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${STAGE_COLOR[lead.stage]}20`, color: STAGE_COLOR[lead.stage], textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {lead.stage}
              </span>
              {lead.deal_value && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning)' }}>${lead.deal_value.toLocaleString()}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                <button onClick={saveLead} disabled={saving}
                  style={{ padding: '8px 18px', background: 'var(--success)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : '✓ Save'}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)}
                  style={{ padding: '8px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                  Edit
                </button>
                <button onClick={deleteLead}
                  style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#F87171', cursor: 'pointer', fontSize: 13 }}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        {[
          { icon: '✉️', label: 'Email', color: '#3B82F6', action: () => openModal('email') },
          { icon: '📞', label: 'Call', color: '#10B981', action: () => { if (lead.phone) window.location.href = `tel:${lead.phone}`; else alert('No phone number saved for this lead.') } },
          { icon: '💬', label: 'SMS', color: '#8B5CF6', action: () => openModal('sms') },
          { icon: '📝', label: 'Note', color: '#F59E0B', action: () => openModal('note') },
        ].map(({ icon, label, color, action }) => (
          <button key={label} onClick={action}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'var(--surface)', border: `1px solid ${color}40`, borderRadius: 9, color, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = `${color}15`)}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}>
            <span>{icon}</span> {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
            <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Contact Info</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {field('First Name', 'first_name')}
              {field('Last Name', 'last_name')}
              {field('Email', 'email', 'email')}
              {field('Phone', 'phone', 'tel')}
              {field('Company', 'company')}
              {field('Title', 'title')}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
            <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Deal Info</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {field('Stage', 'stage', 'text', STAGES)}
              {field('Source', 'source', 'text', ['apollo', 'revscale', 'website', 'referral', 'walk_in', 'other'])}
              {field('Deal Value ($)', 'deal_value', 'number')}
              {field('Project Type', 'project_type')}
              {field('Next Step', 'next_step')}
              {field('Next Step Due', 'next_step_due', 'datetime-local')}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
            <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Notes</h3>
            {editing ? (
              <textarea value={(editForm.notes as string) || ''} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={4}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
            ) : (
              <p style={{ fontSize: 13, color: lead.notes ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {lead.notes || 'No notes yet.'}
              </p>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px', height: 'fit-content', maxHeight: 600, overflow: 'auto' }}>
          <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Activity</h3>
          {activities.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No activity yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activities.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10 }}>
                <div style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{ACTIVITY_ICONS[a.type] || '•'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'capitalize', marginBottom: 2 }}>{a.type.replace('_', ' ')}</div>
                  {a.body && <p style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 3 }}>{a.body}</p>}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeSince(a.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
          onClick={() => setModal(null)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, width: 440, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {modal === 'sms' ? '💬 Send SMS' : modal === 'email' ? '✉️ Send Email' : '📝 Add Note'}
              </span>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {modal === 'email' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Subject</label>
                  <input value={modalSubject} onChange={e => setModalSubject(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {modal === 'note' ? 'Note' : 'Message'}
                </label>
                <textarea value={modalBody} onChange={e => setModalBody(e.target.value)} rows={5}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
              </div>
              {modalMsg && <p style={{ fontSize: 13, color: modalMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{modalMsg}</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setModal(null)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                <button onClick={sendModal} disabled={modalSending || !modalBody.trim()}
                  style={{ padding: '8px 20px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 13, cursor: modalSending ? 'not-allowed' : 'pointer', opacity: modalBody.trim() ? 1 : 0.5 }}>
                  {modalSending ? 'Sending…' : modal === 'note' ? 'Save Note' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
