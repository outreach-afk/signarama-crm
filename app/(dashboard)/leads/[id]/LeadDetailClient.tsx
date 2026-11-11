'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Activity, Stage } from '@/types/database'
import { apolloMatch, isMachineTag, revscaleSignals, sentiment } from '@/lib/leads'
import { ChannelPill, DUE_COLOR, LogTouch, Pill, dueText } from '@/components/LeadBits'
import { followUp, type TouchType } from '@/lib/cadence'
import { Sparkles, Search } from 'lucide-react'

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
  const [modalDrafting, setModalDrafting] = useState(false)

  const openModal = useCallback((m: 'sms' | 'email' | 'note') => {
    setModal(m)
    setModalBody('')
    setModalSubject(m === 'email' ? `Follow up — ${lead?.company || ''}`.trim() : '')
    setModalMsg('')
  }, [lead])

  // Follow-up: last call / email / SMS and the next step from the playbook.
  const fu = lead ? followUp(lead, activities.map(a => ({ lead_id: a.lead_id, type: a.type, created_at: a.created_at, outcome: a.outcome }))) : null
  const lastOf = (t: TouchType) => activities.find(a => a.type === t)

  async function logTouch(type: TouchType, outcome: string) {
    if (!lead) return
    const label = type === 'call' ? 'Call' : type === 'email' ? 'Email' : 'SMS'
    await supabase.from('activities').insert([{ lead_id: id, type, body: `${label} — ${outcome}`, outcome }] as never)
    const changes: Partial<Lead> = {}
    if (lead.stage === 'new') changes.stage = 'contacted'
    if (lead.next_step_due) { changes.next_step_due = null; changes.next_step = null }
    if (Object.keys(changes).length) await supabase.from('leads').update(changes as never).eq('id', id)
    qc.invalidateQueries({ queryKey: ['activities', id] }); qc.invalidateQueries({ queryKey: ['lead', id] }); qc.invalidateQueries({ queryKey: ['touches'] })
  }

  async function snooze(days: number) {
    if (!lead) return
    await supabase.from('leads').update({ next_step_due: new Date(Date.now() + days * 86_400_000).toISOString(), next_step: lead.next_step || fu?.label || 'Follow up' } as never).eq('id', id)
    qc.invalidateQueries({ queryKey: ['lead', id] })
  }

  const [enriching, setEnriching] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState('')
  async function enrich() {
    setEnriching(true); setEnrichMsg('')
    try {
      const r = await fetch('/api/leads/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: id }) })
      const d = await r.json()
      setEnrichMsg(d.error ? `✗ ${d.error}` : d.found ? '✓ Company details added from Apollo. AI drafts will now use them.' : `No match: ${d.message}`)
      qc.invalidateQueries({ queryKey: ['activities', id] }); qc.invalidateQueries({ queryKey: ['lead', id] })
    } catch { setEnrichMsg('✗ Enrichment failed') } finally { setEnriching(false) }
  }
  const enrichment = activities.find(a => a.outcome === 'enrichment')

  async function draftModal() {
    if (!modal || modal === 'note' || !lead) return
    setModalDrafting(true)
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: modal, leadId: id, lead }),
      })
      const data = await res.json()
      if (data.draft) { setModalBody(data.draft); setModalMsg(data.fallback ? `ⓘ ${data.reason}` : data.usedEnrichment ? '✓ Drafted using the company research' : '') }
      else setModalMsg('✗ Could not generate draft')
    } catch {
      setModalMsg('✗ AI draft failed')
    } finally {
      setModalDrafting(false)
    }
  }

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
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <ChannelPill lead={lead} />
              {apolloMatch(lead) === 'yes' && <Pill color="#F59E0B" title="Matches a contact in Apollo cold outreach">From Apollo outreach</Pill>}
              {apolloMatch(lead) === 'possible' && <Pill color="#94A3B8" title="Same name as an Apollo contact, different email">Possible Apollo match</Pill>}
              {sentiment(lead) && <Pill color={sentiment(lead)!.tone === 'positive' ? '#34D399' : sentiment(lead)!.tone === 'negative' ? '#F87171' : '#FCD34D'}>↩ {sentiment(lead)!.label}</Pill>}
              {revscaleSignals(lead).map(sig => <Pill key={sig} color="#64748B">{sig}</Pill>)}
              {(lead.tags || []).filter(t => !isMachineTag(t)).map(t => <Pill key={t} color="#3B82F6">{t}</Pill>)}
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· added {new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
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

      {/* Follow-up */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 22px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 15, fontWeight: 700 }}>Follow-up</h3>
              {fu && <Pill color={DUE_COLOR[fu.state]}>{dueText(fu) || 'On track'}</Pill>}
              {fu && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fu.cadence.name}</span>}
            </div>
            {fu ? (
              <>
                <div style={{ fontSize: 14 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{fu.step ? `Next · step ${fu.stepIndex + 1} of ${fu.cadence.steps.length}: ` : 'Next: '}</span>
                  <b style={{ fontWeight: 600 }}>{fu.label}</b>
                  {fu.dueAt && <span style={{ color: 'var(--text-secondary)' }}> · {new Date(fu.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
                </div>
                {fu.step && <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 6, maxWidth: 620 }}>{fu.step.script.replace(/\{first\}/g, lead.first_name || 'there').replace(/\{need\}/g, 'your project').replace(/\{rep\}/g, '[your name]')}</p>}
                {fu.step && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                    {fu.cadence.steps.map((st, i) => (
                      <span key={i} title={`${i + 1}. ${st.title}`} style={{ width: 22, height: 5, borderRadius: 3, background: i < fu.stepIndex ? '#10B981' : i === fu.stepIndex ? '#F59E0B' : 'var(--border)' }} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {['won', 'completed', 'lost'].includes(lead.stage) ? 'Closed — no follow-up scheduled.' : 'No follow-up sequence for cold leads. Log a touch or move it to Contacted to start one.'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {(['call', 'email', 'sms'] as const).map(t => {
              const a = lastOf(t)
              return (
                <div key={t} style={{ minWidth: 96 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last {t === 'sms' ? 'text' : t}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{a ? timeSince(a.created_at) : 'Never'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{a ? `${new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${a.outcome && a.outcome !== 'Sent' ? ` · ${a.outcome}` : ''}` : '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <LogTouch onLog={logTouch} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>Remind me:</span>
          {[[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']].map(([d, t]) => (
            <button key={t} onClick={() => snooze(d as number)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{t}</button>
          ))}
        </div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 15, fontWeight: 700 }}>Company research</h3>
              <button onClick={enrich} disabled={enriching} title="Looks this person and company up in Apollo. Uses one Apollo credit when a person is matched."
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: enriching ? 'wait' : 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                <Search size={13} /> {enriching ? 'Looking up…' : enrichment ? 'Refresh from Apollo' : 'Enrich from Apollo'}
              </button>
            </div>
            {enrichment ? (
              <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{(enrichment.body || '').replace(/^Apollo enrichment\n/, '')}</p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>Nothing yet. Enrich to pull the person&apos;s role and the company&apos;s industry, size and description, which the AI drafts then use to personalise the message.</p>
            )}
            {enrichMsg && <p style={{ fontSize: 12.5, marginTop: 10, color: enrichMsg.startsWith('✓') ? 'var(--success)' : enrichMsg.startsWith('✗') ? 'var(--danger)' : 'var(--warning)' }}>{enrichMsg}</p>}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {modal === 'note' ? 'Note' : 'Message'}
                  </label>
                  {modal !== 'note' && (
                    <button onClick={draftModal} disabled={modalDrafting}
                      style={{ fontSize: 11, padding: '3px 10px', background: 'linear-gradient(135deg, #7C3AED, #4F46E5)', border: 'none', borderRadius: 5, color: '#fff', cursor: modalDrafting ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: modalDrafting ? 0.7 : 1 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={11} /> {modalDrafting ? 'Drafting…' : 'Draft with AI'}</span>
                    </button>
                  )}
                </div>
                <textarea value={modalBody} onChange={e => setModalBody(e.target.value)} rows={5}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
              </div>
              {modalMsg && <p style={{ fontSize: 13, lineHeight: 1.5, color: modalMsg.startsWith('✓') ? 'var(--success)' : modalMsg.startsWith('ⓘ') ? 'var(--warning)' : 'var(--danger)' }}>{modalMsg}</p>}
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
