'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/types/database'
import { CHANNELS, apolloMatch, fetchAllLeads, runApolloSync, timeAgo } from '@/lib/leads'

// ── helpers ──────────────────────────────────────────────────────────────────

function fullName(l: Lead) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email || '(no name)'
}

function fmt(n: number | null) {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`
  return `$${n}`
}

function daysAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

const STAGE_COLORS: Record<string, string> = {
  new: '#64748B', contacted: '#3B82F6', quoted: '#8B5CF6',
  negotiating: '#F59E0B', won: '#10B981', completed: '#34D399', lost: '#EF4444',
}
const STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'completed', 'lost']

// ── animated counter hook ─────────────────────────────────────────────────────

function useCounter(target: number, duration = 900) {
  const [value, setValue] = useState(0)
  const raf = useRef<number>(0)
  const start = useRef<number | null>(null)
  const prev = useRef(0)

  useEffect(() => {
    const from = prev.current
    prev.current = target
    start.current = null
    cancelAnimationFrame(raf.current)
    const step = (ts: number) => {
      if (!start.current) start.current = ts
      const p = Math.min((ts - start.current) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (target - from) * ease))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration])

  return value
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, accent, icon, sub }: {
  label: string; value: number; accent: string; icon: string; sub?: string
}) {
  const display = useCounter(value)
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${accent}33`,
      borderRadius: 14,
      padding: '20px 22px 18px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accent}00, ${accent}, ${accent}00)`,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <span style={{ fontSize: 18, opacity: 0.7 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 36, fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginBottom: 4 }}>
        {display.toLocaleString()}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function SourceBadge({ source, subtype }: { source: string; subtype?: string | null }) {
  const map: Record<string, { label: string; color: string; icon: string }> = {
    'revscale:web_pixel': { label: 'Web Pixel', color: CHANNELS.web_pixel.color, icon: CHANNELS.web_pixel.icon },
    'revscale:inquiry': { label: 'Inquiry', color: CHANNELS.inquiry.color, icon: CHANNELS.inquiry.icon },
    'revscale:linkedin_outbound': { label: 'LinkedIn', color: CHANNELS.linkedin_outbound.color, icon: CHANNELS.linkedin_outbound.icon },
    'revscale:lead_finder': { label: 'Finder', color: CHANNELS.lead_finder.color, icon: CHANNELS.lead_finder.icon },
    'revscale': { label: 'Revscale', color: '#6366F1', icon: '🤖' },
    'apollo': { label: 'Apollo', color: '#F59E0B', icon: '🚀' },
    'website': { label: 'Website', color: '#10B981', icon: '🌐' },
    'referral': { label: 'Referral', color: '#EC4899', icon: '🤝' },
    'walk_in': { label: 'Walk-in', color: '#14B8A6', icon: '🏪' },
    'other': { label: 'Other', color: '#64748B', icon: '•' },
  }
  const key = subtype ? `${source}:${subtype}` : source
  const s = map[key] || map[source] || map.other
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}30`,
      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {s.icon} {s.label}
    </span>
  )
}

function PipelineFunnel({ leads }: { leads: Lead[] }) {
  const counts = STAGES.reduce((a, s) => ({ ...a, [s]: 0 }), {} as Record<string, number>)
  for (const l of leads) counts[l.stage] = (counts[l.stage] || 0) + 1
  const max = Math.max(...Object.values(counts), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {STAGES.filter(s => counts[s] > 0).map(s => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 80, textTransform: 'capitalize', flexShrink: 0 }}>{s}</span>
          <div style={{ flex: 1, height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              width: `${(counts[s] / max) * 100}%`,
              background: STAGE_COLORS[s],
              transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
            }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: STAGE_COLORS[s], width: 24, textAlign: 'right' }}>{counts[s]}</span>
        </div>
      ))}
    </div>
  )
}

function SourcePanel({ leads }: { leads: Lead[] }) {
  const bySource: Record<string, number> = {}
  for (const l of leads) {
    const k = l.source_subtype ? `${l.source}:${l.source_subtype}` : l.source
    bySource[k] = (bySource[k] || 0) + 1
  }
  const total = leads.length || 1
  const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1])

  const colors: Record<string, string> = {
    'revscale:web_pixel': CHANNELS.web_pixel.color, 'revscale:inquiry': CHANNELS.inquiry.color,
    'revscale:linkedin_outbound': CHANNELS.linkedin_outbound.color, 'revscale:lead_finder': CHANNELS.lead_finder.color,
    revscale: '#6366F1', apollo: '#F59E0B', website: '#10B981',
    referral: '#EC4899', walk_in: '#14B8A6', other: '#64748B',
  }
  const labels: Record<string, string> = {
    'revscale:web_pixel': 'Revscale · Web Pixel', 'revscale:inquiry': 'Revscale · Inquiry',
    'revscale:linkedin_outbound': 'Revscale · LinkedIn (cold)', 'revscale:lead_finder': 'Revscale · Lead Finder (cold)',
    revscale: 'Revscale', apollo: 'Apollo.io', website: 'Website',
    referral: 'Referral', walk_in: 'Walk-in', other: 'Other',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(([key, count]) => (
        <div key={key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{labels[key] || key}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: colors[key] || '#64748B' }}>
              {count} <span style={{ fontWeight: 400, opacity: 0.6 }}>({Math.round((count / total) * 100)}%)</span>
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${(count / total) * 100}%`,
              background: colors[key] || '#64748B',
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>
      ))}
      {entries.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0' }}>No leads yet</p>
      )}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function DashboardClient() {
  const supabase = createClient()

  const { data: leads = [], refetch } = useQuery({
    queryKey: ['leads'],
    queryFn: () => fetchAllLeads<Lead>(supabase),
  })

  // Revscale is pushed in by the scheduled sync, so show how fresh it is instead of a pull button.
  const { data: rs, refetch: refetchRs } = useQuery({
    queryKey: ['revscale-status'],
    queryFn: async () => (await fetch('/api/leads/sync')).json() as Promise<{ lastSyncedAt?: string | null; newestWarmLeadAt?: string | null }>,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    const ch = supabase.channel('leads-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => refetch())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase, refetch])

  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState('')

  async function runSync(src: 'apollo' | 'revscale') {
    setSyncing(src); setSyncMsg('')
    try {
      if (src === 'apollo') {
        const d = await runApolloSync(setSyncMsg)
        setSyncMsg(`✓ Apollo: ${d.imported.toLocaleString()} contacts synced · ${d.matchedToRevscale ?? 0} reached Revscale`)
      } else {
        const r = await fetch('/api/leads/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: src }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Error')
        setSyncMsg(`✓ Revscale up to date · last synced ${timeAgo(d.lastSyncedAt)} · ${d.matchedToApollo} from Apollo outreach`)
      }
      refetch(); refetchRs()
    } catch (e) { setSyncMsg(`✗ ${e instanceof Error ? e.message : 'Network error'}`) }
    finally { setSyncing(null) }
  }

  // Stats
  const total = leads.length
  const active = leads.filter(l => !['won', 'completed', 'lost'].includes(l.stage)).length
  const pipeline = leads.reduce((s, l) => s + (l.deal_value || 0), 0)
  const won = leads.filter(l => ['won', 'completed'].includes(l.stage)).length
  const fromRevscale = leads.filter(l => l.source === 'revscale').length
  const webPixel = leads.filter(l => l.source === 'revscale' && l.source_subtype === 'web_pixel').length
  const inquiries = leads.filter(l => l.source === 'revscale' && l.source_subtype === 'inquiry').length
  const apolloToRevscale = leads.filter(l => l.source === 'revscale' && apolloMatch(l) === 'yes').length
  const [now] = useState(() => Date.now())
  const warmThisWeek = leads.filter(l => l.source === 'revscale' && ['web_pixel', 'inquiry'].includes(l.source_subtype || '') && now - new Date(l.created_at).getTime() < 7 * 86_400_000).length
  const fromApollo = leads.filter(l => l.source === 'apollo').length

  const overdue = leads.filter(l =>
    l.next_step_due && new Date(l.next_step_due) < new Date() &&
    !['won', 'completed', 'lost'].includes(l.stage)
  )
  // Lead with what matters: the newest warm leads, not whatever was imported last.
  const warm = leads.filter(l => l.source === 'revscale' && ['web_pixel', 'inquiry'].includes(l.source_subtype || ''))
  const recent = (warm.length ? warm : leads).slice(0, 10)

  // Quick compose
  const [quickLead, setQuickLead] = useState<Lead | null>(null)
  const [quickMode, setQuickMode] = useState<'sms' | 'email' | null>(null)
  const [quickBody, setQuickBody] = useState('')
  const [quickSubject, setQuickSubject] = useState('')
  const [quickSending, setQuickSending] = useState(false)
  const [quickMsg, setQuickMsg] = useState('')

  const openQuick = useCallback((lead: Lead, mode: 'sms' | 'email') => {
    setQuickLead(lead); setQuickMode(mode)
    setQuickBody(''); setQuickMsg('')
    setQuickSubject(mode === 'email' ? `Follow up — ${lead.company || fullName(lead)}` : '')
  }, [])
  const closeQuick = useCallback(() => { setQuickLead(null); setQuickMode(null) }, [])

  async function sendQuick() {
    if (!quickLead || !quickMode || !quickBody.trim()) return
    setQuickSending(true)
    try {
      const ep = quickMode === 'sms' ? '/api/sms/send' : '/api/email/send'
      const body = quickMode === 'sms'
        ? { leadId: quickLead.id, to: quickLead.phone, body: quickBody }
        : { leadId: quickLead.id, to: quickLead.email, subject: quickSubject, body: quickBody }
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('Failed')
      setQuickMsg('✓ Sent!'); setTimeout(closeQuick, 1200)
    } catch { setQuickMsg('✗ Failed to send') }
    finally { setQuickSending(false) }
  }

  return (
    <div style={{ padding: '28px 28px 64px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 24, fontWeight: 800, marginBottom: 2, letterSpacing: '-0.02em' }}>
            Signarama CRM
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Live pipeline · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        {/* Sync buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {syncMsg && <span style={{ fontSize: 12, color: syncMsg.startsWith('✗') ? '#EF4444' : syncMsg.startsWith('✓') ? '#10B981' : 'var(--text-secondary)' }}>{syncMsg}</span>}
          <button onClick={() => runSync('revscale')} disabled={!!syncing}
            title="Revscale leads arrive automatically every hour. Click to re-check freshness and the Apollo match."
            style={{ padding: '8px 14px', background: syncing === 'revscale' ? 'var(--surface-2)' : 'linear-gradient(135deg,#6366F1,#8B5CF6)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing && syncing !== 'revscale' ? 0.5 : 1 }}>
            {syncing === 'revscale' ? '⟳ Checking…' : `↻ Revscale · ${timeAgo(rs?.lastSyncedAt)}`}
          </button>
          <button onClick={() => runSync('apollo')} disabled={!!syncing}
            style={{ padding: '8px 14px', background: syncing === 'apollo' ? 'var(--surface-2)' : 'linear-gradient(135deg,#F59E0B,#EF4444)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing && syncing !== 'apollo' ? 0.5 : 1 }}>
            {syncing === 'apollo' ? '⟳ Syncing…' : '↻ Apollo'}
          </button>
          <Link href="/leads?new=1" style={{ padding: '8px 14px', background: 'var(--primary)', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
            + Add Lead
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
        <Link href="/leads?view=revscale&channel=web_pixel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatCard label="Web Pixel" value={webPixel} accent={CHANNELS.web_pixel.color} icon="📡" sub="Identified website visitors" />
        </Link>
        <Link href="/leads?view=revscale&channel=inquiry" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatCard label="Inquiries" value={inquiries} accent={CHANNELS.inquiry.color} icon="📨" sub="Asked for a quote" />
        </Link>
        <Link href="/leads?view=revscale" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatCard label="Warm This Week" value={warmThisWeek} accent="#F59E0B" icon="🔥" sub="New pixel + inquiry leads, 7 days" />
        </Link>
        <Link href="/leads?view=revscale" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatCard label="Apollo → Revscale" value={apolloToRevscale} accent="#EC4899" icon="🔁" sub="Cold outreach that came back warm" />
        </Link>
        <Link href="/leads?view=apollo" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatCard label="Apollo Contacts" value={fromApollo} accent="#F59E0B" icon="🚀" sub="In cold outreach" />
        </Link>
        <StatCard label="Won / Closed" value={won} accent="#34D399" icon="🏆" sub={`${fmt(pipeline)} pipeline · ${active.toLocaleString()} active`} />
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: '#F87171', fontWeight: 600 }}>{overdue.length} overdue follow-up{overdue.length > 1 ? 's' : ''}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 8 }}>
            {overdue.slice(0, 5).map(l => (
              <Link key={l.id} href={`/leads/${l.id}`} style={{ fontSize: 12, color: '#F87171', padding: '2px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 99, textDecoration: 'none' }}>
                {fullName(l)} · {l.next_step_due ? new Date(l.next_step_due).toLocaleDateString() : ''}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Recent leads */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{warm.length ? 'Newest Warm Leads' : 'Recent Leads'}</span>
            <Link href={warm.length ? '/leads?view=revscale' : '/leads'} style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}>View all →</Link>
          </div>
          <div>
            {recent.map(lead => (
              <div key={lead.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: '1px solid var(--border)' }}>
                <Link href={`/leads/${lead.id}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(lead)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {lead.company && `${lead.company} · `}{daysAgo(lead.created_at)}
                  </div>
                </Link>
                <SourceBadge source={lead.source} subtype={lead.source_subtype} />
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, flexShrink: 0,
                  background: `${STAGE_COLORS[lead.stage] || '#64748B'}18`,
                  color: STAGE_COLORS[lead.stage] || '#64748B',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{lead.stage}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>{fmt(lead.deal_value)}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {lead.email && (
                    <button onClick={() => openQuick(lead, 'email')} title="Quick email"
                      style={{ width: 26, height: 26, borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12 }}>✉</button>
                  )}
                  {lead.phone && (
                    <button onClick={() => openQuick(lead, 'sms')} title="Quick SMS"
                      style={{ width: 26, height: 26, borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12 }}>💬</button>
                  )}
                </div>
              </div>
            ))}
            {recent.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                No leads yet. <Link href="/leads" style={{ color: 'var(--primary)' }}>Add your first →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pipeline funnel */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Pipeline Stages</div>
            <PipelineFunnel leads={leads} />
          </div>

          {/* Lead source attribution */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Lead Sources</div>
            <SourcePanel leads={leads} />
          </div>

          {/* Connector health */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Connectors</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { name: 'RingCentral SMS', color: '#F59E0B', status: 'active' },
                { name: 'Gmail', color: '#EF4444', status: 'active' },
                { name: 'Revscale AI', color: '#8B5CF6', status: fromRevscale > 0 ? 'synced' : 'idle' },
                { name: 'Apollo.io', color: '#F59E0B', status: fromApollo > 0 ? 'synced' : 'idle' },
              ].map(c => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.name}</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                    background: c.status === 'active' || c.status === 'synced' ? '#10B98118' : 'var(--surface-2)',
                    color: c.status === 'active' || c.status === 'synced' ? '#10B981' : 'var(--text-secondary)',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>{c.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick compose modal */}
      {quickLead && quickMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }} onClick={closeQuick}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 440, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {quickMode === 'sms' ? '💬 SMS' : '✉ Email'} → {fullName(quickLead)}
              </span>
              <button onClick={closeQuick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickMode === 'email' && (
                <input value={quickSubject} onChange={e => setQuickSubject(e.target.value)}
                  placeholder="Subject"
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
              )}
              <textarea value={quickBody} onChange={e => setQuickBody(e.target.value)} rows={4}
                placeholder={quickMode === 'sms' ? 'Type your message…' : 'Type your email…'}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
              {quickMsg && <p style={{ fontSize: 13, color: quickMsg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{quickMsg}</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={closeQuick} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                <button onClick={sendQuick} disabled={quickSending || !quickBody.trim()}
                  style={{ padding: '8px 20px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, cursor: quickSending ? 'not-allowed' : 'pointer', fontSize: 13, opacity: quickBody.trim() ? 1 : 0.5 }}>
                  {quickSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
