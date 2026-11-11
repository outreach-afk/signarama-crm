'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Lead, Stage } from '@/types/database'
import {
  CHANNELS, TAG_IN_SEQUENCE, apolloMatch, fetchAllLeads, fullName, leadChannel,
  revscaleSignals, sentiment, timeAgo, type Channel,
} from '@/lib/leads'

const STAGES: Stage[] = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'completed', 'lost']
const STAGE_COLOR: Record<string, string> = {
  new: '#94A3B8', contacted: '#60A5FA', quoted: '#A78BFA',
  negotiating: '#FCD34D', won: '#34D399', completed: '#6EE7B7', lost: '#F87171',
}
const TONE_COLOR = { positive: '#34D399', neutral: '#FCD34D', negative: '#F87171' }
const PAGE = 100

type View = 'revscale' | 'apollo' | 'all'
type Tab = { key: string; label: string; icon?: string; color?: string; hint?: string; match: (l: Lead) => boolean }

const VIEWS: Record<View, { title: string; blurb: string; tabs: Tab[] }> = {
  revscale: {
    title: 'Revscale Leads',
    blurb: 'Warm leads from the website: identified visitors (Web Pixel) and people who sent an inquiry.',
    tabs: [
      { key: 'warm', label: 'All warm', color: '#F59E0B', match: l => ['web_pixel', 'inquiry'].includes(l.source_subtype || '') },
      { key: 'web_pixel', label: 'Web Pixel', color: CHANNELS.web_pixel.color, hint: CHANNELS.web_pixel.hint, match: l => l.source_subtype === 'web_pixel' },
      { key: 'inquiry', label: 'Inquiry', color: CHANNELS.inquiry.color, hint: CHANNELS.inquiry.hint, match: l => l.source_subtype === 'inquiry' },
      { key: 'outbound', label: 'Cold outbound', color: '#8B5CF6', hint: 'LinkedIn outreach and Lead Finder prospects — not warm yet', match: l => !['web_pixel', 'inquiry'].includes(l.source_subtype || '') },
    ],
  },
  apollo: {
    title: 'Apollo Leads',
    blurb: 'Contacts we cold-email from Apollo. "Reached Revscale" means they later showed up as a warm Revscale lead.',
    tabs: [
      { key: 'all', label: 'All contacts', color: '#F59E0B', match: () => true },
      { key: 'sequence', label: 'In a sequence', color: '#60A5FA', match: l => (l.tags || []).includes(TAG_IN_SEQUENCE) },
    ],
  },
  all: {
    title: 'All Leads',
    blurb: 'Every lead from every source.',
    tabs: [{ key: 'all', label: 'Everything', match: () => true }],
  },
}

const EMPTY_FORM = {
  first_name: '', last_name: '', email: '', phone: '',
  company: '', title: '', stage: 'new' as Stage,
  deal_value: '', next_step: '', next_step_due: '',
  notes: '', source: 'other', project_type: '',
}

function Pill({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, background: `${color}1c`, color, border: `1px solid ${color}33`,
      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export default function LeadsClient() {
  const supabase = useMemo(() => createClient(), [])
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()

  const view = (['revscale', 'apollo', 'all'].includes(searchParams.get('view') || '') ? searchParams.get('view') : 'all') as View
  const cfg = VIEWS[view]
  const tabKey = cfg.tabs.some(t => t.key === searchParams.get('channel')) ? searchParams.get('channel')! : cfg.tabs[0].key
  const tab = cfg.tabs.find(t => t.key === tabKey)!

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<Stage | ''>('')
  const [onlyApollo, setOnlyApollo] = useState(false)
  const [onlyReplied, setOnlyReplied] = useState(false)
  const [paging, setPaging] = useState({ sig: '', n: PAGE })
  const [showModal, setShowModal] = useState(searchParams.get('new') === '1')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: () => fetchAllLeads<Lead>(supabase),
  })

  useEffect(() => {
    const ch = supabase.channel('leads-list-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => qc.invalidateQueries({ queryKey: ['leads'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, qc])

  // Paging resets whenever the view or a filter changes.
  const sig = [view, tabKey, search, stageFilter, onlyApollo, onlyReplied].join('|')
  const shown = paging.sig === sig ? paging.n : PAGE

  const inView = useMemo(() => leads.filter(l => view === 'all' || l.source === view), [leads, view])

  // For the Apollo view: which Apollo contacts later became a Revscale lead.
  const reachedRevscale = useMemo(() => {
    const emails = new Set<string>(), names = new Set<string>()
    for (const l of leads) {
      if (l.source !== 'revscale' || !apolloMatch(l)) continue
      if (l.email) emails.add(l.email.toLowerCase())
      if (l.first_name && l.last_name) names.add(`${l.first_name} ${l.last_name}`.toLowerCase())
    }
    return (l: Lead) => l.source === 'apollo' && (
      (!!l.email && emails.has(l.email.toLowerCase())) ||
      (!!l.first_name && !!l.last_name && names.has(`${l.first_name} ${l.last_name}`.toLowerCase()))
    )
  }, [leads])

  const isApolloLinked = (l: Lead) => (l.source === 'apollo' ? reachedRevscale(l) : !!apolloMatch(l))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inView.filter(l => {
      if (!tab.match(l)) return false
      if (stageFilter && l.stage !== stageFilter) return false
      if (onlyApollo && !isApolloLinked(l)) return false
      if (onlyReplied && !(l.tags || []).includes('rs:replied')) return false
      if (!q) return true
      return fullName(l).toLowerCase().includes(q) ||
        (l.company || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, tab, stageFilter, onlyApollo, onlyReplied, search, reachedRevscale])

  function go(params: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    sp.delete('new')
    for (const [k, v] of Object.entries(params)) { if (v) sp.set(k, v); else sp.delete(k) }
    router.replace(`/leads?${sp.toString()}`)
  }

  async function setStage(lead: Lead, stage: Stage) {
    qc.setQueryData<Lead[]>(['leads'], old => (old || []).map(l => (l.id === lead.id ? { ...l, stage } : l)))
    const { error } = await supabase.from('leads').update({ stage } as never).eq('id', lead.id)
    if (error) qc.invalidateQueries({ queryKey: ['leads'] })
  }

  async function saveLead() {
    setSaving(true); setError('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = { ...form, deal_value: form.deal_value ? Number(form.deal_value) : null, next_step_due: form.next_step_due || null }
    const { error } = await supabase.from('leads').insert([payload] as never)
    if (error) { setError(error.message); setSaving(false) }
    else {
      qc.invalidateQueries({ queryKey: ['leads'] })
      setShowModal(false); setForm(EMPTY_FORM); setSaving(false)
      go({})
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

  const showChannel = view !== 'apollo'
  const apolloHeader = view === 'apollo' ? 'Reached Revscale' : 'Apollo outreach'
  const headers = ['Name', 'Company', ...(showChannel ? ['Channel'] : []), apolloHeader, 'Signals', 'Stage', 'Added']
  const apolloCount = inView.filter(l => tab.match(l) && isApolloLinked(l)).length

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>{cfg.title}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 640 }}>{cfg.blurb}</p>
        </div>
        <button onClick={() => setShowModal(true)}
          style={{ padding: '10px 20px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>
          + Add Lead
        </button>
      </div>

      {/* Channel tabs */}
      {cfg.tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          {cfg.tabs.map(t => {
            const active = t.key === tabKey
            const count = inView.filter(t.match).length
            const color = t.color || 'var(--primary)'
            return (
              <button key={t.key} onClick={() => go({ channel: t.key === cfg.tabs[0].key ? null : t.key })} title={t.hint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
                  background: active ? `${color}18` : 'var(--surface)',
                  border: `1px solid ${active ? color : 'var(--border)'}`,
                  color: active ? color : 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
                }}>
                <i style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
                {t.label}
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: active ? color : 'var(--text)' }}>{count.toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, company, email…"
          style={{ flex: 1, minWidth: 220, padding: '9px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value as Stage | '')}
          style={{ padding: '9px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {[
          { on: onlyApollo, set: setOnlyApollo, label: view === 'apollo' ? `Reached Revscale (${apolloCount})` : `From Apollo outreach (${apolloCount})`, color: '#F59E0B' },
          ...(view !== 'apollo' ? [{ on: onlyReplied, set: setOnlyReplied, label: 'Replied', color: '#34D399' }] : []),
        ].map(f => (
          <button key={f.label} onClick={() => f.set(!f.on)}
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: f.on ? `${f.color}1c` : 'var(--surface)', color: f.on ? f.color : 'var(--text-secondary)',
              border: `1px solid ${f.on ? f.color : 'var(--border)'}`,
            }}>
            {f.on ? '✓ ' : ''}{f.label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {filtered.length.toLocaleString()} lead{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {headers.map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, shown).map(lead => {
              const ch = leadChannel(lead)
              const chInfo = ch ? CHANNELS[ch as Channel] : null
              const match = lead.source === 'apollo' ? (reachedRevscale(lead) ? 'yes' : null) : apolloMatch(lead)
              const signals = revscaleSignals(lead).filter(s => s.toLowerCase() !== 'replied')
              const replied = (lead.tags || []).includes('rs:replied')
              const mood = sentiment(lead)
              return (
                <tr key={lead.id}
                  onClick={() => router.push(`/leads/${lead.id}`)}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 16px', maxWidth: 260 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName(lead)}</div>
                    {lead.email && fullName(lead) !== lead.email && <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.email}</div>}
                    {!lead.email && lead.title && <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                  {showChannel && (
                    <td style={{ padding: '12px 16px' }}>
                      {chInfo
                        ? <Pill color={chInfo.color} title={chInfo.hint}>{chInfo.icon} {chInfo.label}</Pill>
                        : <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{lead.source.replace('_', ' ')}</span>}
                    </td>
                  )}
                  <td style={{ padding: '12px 16px' }}>
                    {match === 'yes' && <Pill color="#F59E0B" title={lead.source === 'apollo' ? 'This Apollo contact later appeared as a Revscale lead' : 'Matches an Apollo contact by email, or by name and company'}>{lead.source === 'apollo' ? 'Yes' : 'Apollo'}</Pill>}
                    {match === 'possible' && <Pill color="#94A3B8" title="Same full name as an Apollo contact, but a different email — check before counting it">Possible</Pill>}
                    {!match && <span style={{ color: 'var(--text-muted, #64748B)', fontSize: 13 }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {replied && <Pill color={mood ? TONE_COLOR[mood.tone] : '#34D399'} title={mood ? `Reply sentiment: ${mood.label}` : 'Replied'}>↩ {mood ? mood.label : 'Replied'}</Pill>}
                      {signals.slice(0, 2).map(s => <Pill key={s} color="#64748B">{s}</Pill>)}
                      {!replied && signals.length === 0 && <span style={{ color: 'var(--text-muted, #64748B)', fontSize: 13 }}>—</span>}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                    <select value={lead.stage} onChange={e => setStage(lead, e.target.value as Stage)} title="Change stage"
                      style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 6px', borderRadius: 99, cursor: 'pointer', outline: 'none',
                        background: `${STAGE_COLOR[lead.stage]}20`, color: STAGE_COLOR[lead.stage],
                        border: `1px solid ${STAGE_COLOR[lead.stage]}40`, textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                      {STAGES.map(s => <option key={s} value={s} style={{ background: '#111', color: '#fff' }}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }} title={new Date(lead.created_at).toLocaleString()}>
                    {timeAgo(lead.created_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {isLoading ? 'Loading leads…' : inView.length === 0 ? 'No leads here yet.' : 'No leads match your filters.'}
          </div>
        )}
        {filtered.length > shown && (
          <button onClick={() => setPaging({ sig, n: shown + PAGE })}
            style={{ width: '100%', padding: '12px', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Show {Math.min(PAGE, filtered.length - shown)} more · {(filtered.length - shown).toLocaleString()} remaining
          </button>
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
