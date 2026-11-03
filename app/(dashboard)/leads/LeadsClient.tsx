'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Stage } from '@/types/database'

const STAGES: Stage[] = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'completed', 'lost']
const STAGE_COLOR: Record<string, string> = {
  new: '#94A3B8', contacted: '#60A5FA', quoted: '#A78BFA',
  negotiating: '#FCD34D', won: '#34D399', completed: '#6EE7B7', lost: '#F87171',
}

function fullName(l: Lead) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email || '(no name)'
}

const EMPTY_FORM = {
  first_name: '', last_name: '', email: '', phone: '',
  company: '', title: '', stage: 'new' as Stage,
  deal_value: '', next_step: '', next_step_due: '',
  notes: '', source: 'other', project_type: '',
}

export default function LeadsClient() {
  const supabase = createClient()
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<Stage | ''>('')
  const [showModal, setShowModal] = useState(searchParams.get('new') === '1')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Lead[]
    },
  })

  useEffect(() => {
    const ch = supabase.channel('leads-list-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => qc.invalidateQueries({ queryKey: ['leads'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, qc])

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    if (stageFilter && l.stage !== stageFilter) return false
    if (!q) return true
    return fullName(l).toLowerCase().includes(q) ||
      (l.company || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q)
  })

  async function saveLead() {
    setSaving(true); setError('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = { ...form, deal_value: form.deal_value ? Number(form.deal_value) : null, next_step_due: form.next_step_due || null }
    const { error } = await supabase.from('leads').insert([payload] as never)
    if (error) { setError(error.message); setSaving(false) }
    else {
      qc.invalidateQueries({ queryKey: ['leads'] })
      setShowModal(false); setForm(EMPTY_FORM)
      router.replace('/leads')
    }
  }

  const inp = (label: string, key: keyof typeof form, type = 'text', opts?: string[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {opts ? (
        <select value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key] as string}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          style={{ padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
      )}
    </div>
  )

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Leads</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{leads.length} total leads</p>
        </div>
        <button onClick={() => setShowModal(true)}
          style={{ padding: '10px 20px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          + Add Lead
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, company, email…"
          style={{ flex: 1, padding: '9px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value as Stage | '')}
          style={{ padding: '9px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Name', 'Company', 'Stage', 'Value', 'Next Step', 'Source', 'Added'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(lead => {
              const overdue = lead.next_step_due && new Date(lead.next_step_due) < new Date() && !['won', 'completed', 'lost'].includes(lead.stage)
              return (
                <tr key={lead.id}
                  onClick={() => router.push(`/leads/${lead.id}`)}
                  style={{
                    borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    background: overdue ? 'rgba(239,68,68,0.04)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = overdue ? 'rgba(239,68,68,0.08)' : 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = overdue ? 'rgba(239,68,68,0.04)' : 'transparent')}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{fullName(lead)}</div>
                    {lead.email && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{lead.email}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{lead.company || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${STAGE_COLOR[lead.stage]}20`, color: STAGE_COLOR[lead.stage], textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {lead.stage}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    {lead.deal_value ? `$${lead.deal_value.toLocaleString()}` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {lead.next_step && <div style={{ fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.next_step}</div>}
                    {lead.next_step_due && <div style={{ fontSize: 11, color: overdue ? '#F87171' : 'var(--text-secondary)' }}>{new Date(lead.next_step_due).toLocaleDateString()}</div>}
                    {!lead.next_step && '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{lead.source}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(lead.created_at).toLocaleDateString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {leads.length === 0 ? 'No leads yet — add your first one!' : 'No leads match your filters.'}
          </div>
        )}
      </div>

      {/* Add Lead Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
          onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 28px', width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 22 }}>
              <span style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontWeight: 700, fontSize: 18 }}>Add New Lead</span>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 20 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {inp('First Name', 'first_name')}
              {inp('Last Name', 'last_name')}
              {inp('Email', 'email', 'email')}
              {inp('Phone', 'phone', 'tel')}
              {inp('Company', 'company')}
              {inp('Title', 'title')}
              {inp('Stage', 'stage', 'text', STAGES)}
              {inp('Source', 'source', 'text', ['apollo', 'revscale', 'website', 'referral', 'walk_in', 'other'])}
              {inp('Deal Value ($)', 'deal_value', 'number')}
              {inp('Project Type', 'project_type')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              {inp('Next Step', 'next_step')}
              {inp('Next Step Due', 'next_step_due', 'datetime-local')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                  style={{ padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
              </div>
            </div>

            {error && <p style={{ color: '#F87171', fontSize: 13, marginTop: 10 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowModal(false)}
                style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={saveLead} disabled={saving}
                style={{ padding: '9px 22px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving…' : 'Add Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
