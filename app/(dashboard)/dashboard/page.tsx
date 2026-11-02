'use client'

import { useEffect, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Lead } from '@/types/database'

const STAGE_COLORS: Record<string, string> = {
  new: '#94A3B8', contacted: '#60A5FA', quoted: '#A78BFA',
  negotiating: '#FCD34D', won: '#34D399', completed: '#6EE7B7', lost: '#F87171',
}

function fmt(n: number | null) {
  if (!n) return '—'
  return n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`
}

function fullName(l: Lead) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email || '(no name)'
}

function daysAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

export default function DashboardPage() {
  const supabase = createClient()

  const { data: leads = [], refetch } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Lead[]
    },
  })

  // Realtime
  useEffect(() => {
    const channel = supabase.channel('leads-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => refetch())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, refetch])

  // Stats
  const stats = {
    total: leads.length,
    active: leads.filter(l => !['won', 'completed', 'lost'].includes(l.stage)).length,
    pipeline: leads.reduce((s, l) => s + (l.deal_value || 0), 0),
    won: leads.filter(l => l.stage === 'won' || l.stage === 'completed').length,
  }

  const overdue = leads.filter(l =>
    l.next_step_due && new Date(l.next_step_due) < new Date() &&
    !['won', 'completed', 'lost'].includes(l.stage)
  )

  const recent = leads.slice(0, 8)

  const stageCounts = leads.reduce((acc, l) => {
    acc[l.stage] = (acc[l.stage] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Quick-action compose state
  const [quickLead, setQuickLead] = useState<Lead | null>(null)
  const [quickMode, setQuickMode] = useState<'sms' | 'email' | null>(null)
  const [quickBody, setQuickBody] = useState('')
  const [quickSubject, setQuickSubject] = useState('')
  const [quickSending, setQuickSending] = useState(false)
  const [quickMsg, setQuickMsg] = useState('')

  const openQuick = useCallback((lead: Lead, mode: 'sms' | 'email') => {
    setQuickLead(lead)
    setQuickMode(mode)
    setQuickBody('')
    setQuickSubject(mode === 'email' ? `Follow up — ${lead.company || fullName(lead)}` : '')
    setQuickMsg('')
  }, [])

  const closeQuick = useCallback(() => {
    setQuickLead(null); setQuickMode(null)
  }, [])

  async function sendQuick() {
    if (!quickLead || !quickMode || !quickBody.trim()) return
    setQuickSending(true)
    try {
      const endpoint = quickMode === 'sms' ? '/api/sms/send' : '/api/email/send'
      const body = quickMode === 'sms'
        ? { leadId: quickLead.id, to: quickLead.phone, body: quickBody }
        : { leadId: quickLead.id, to: quickLead.email, subject: quickSubject, body: quickBody }
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Failed')
      setQuickMsg('✓ Sent!')
      setTimeout(closeQuick, 1200)
    } catch {
      setQuickMsg('✗ Failed to send')
    } finally {
      setQuickSending(false)
    }
  }

  const card = (label: string, value: string | number, color = 'var(--primary)') => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: 'Bricolage Grotesque, sans-serif' }}>{value}</div>
    </div>
  )

  return (
    <div style={{ padding: '32px 32px 64px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Welcome back — here's your pipeline at a glance.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {card('Total Leads', stats.total)}
        {card('Active', stats.active, 'var(--success)')}
        {card('Pipeline Value', stats.pipeline >= 1000 ? `$${(stats.pipeline / 1000).toFixed(0)}k` : `$${stats.pipeline}`, 'var(--warning)')}
        {card('Won / Closed', stats.won, '#A78BFA')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
        {/* Recent leads */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Recent Leads</span>
            <Link href="/leads" style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none' }}>View all →</Link>
          </div>
          <div>
            {recent.map(lead => (
              <div key={lead.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'transparent' }}>
                <Link href={`/leads/${lead.id}`} style={{ flex: 1, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(lead)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {lead.company && <span>{lead.company} · </span>}
                    {daysAgo(lead.created_at)}
                  </div>
                </Link>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                  background: `${STAGE_COLORS[lead.stage]}20`, color: STAGE_COLORS[lead.stage],
                  textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
                }}>
                  {lead.stage}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 40, textAlign: 'right' }}>{fmt(lead.deal_value)}</span>
                {/* Quick actions */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {lead.email && (
                    <button onClick={() => openQuick(lead, 'email')} title="Quick email"
                      style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13 }}>
                      ✉
                    </button>
                  )}
                  {lead.phone && (
                    <button onClick={() => openQuick(lead, 'sms')} title="Quick SMS"
                      style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13 }}>
                      💬
                    </button>
                  )}
                </div>
              </div>
            ))}
            {recent.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No leads yet. <Link href="/leads" style={{ color: 'var(--primary)' }}>Add your first lead →</Link>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pipeline by stage */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Pipeline Stages</div>
            {Object.entries(stageCounts).map(([stage, count]) => (
              <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[stage] }} />
                  <span style={{ fontSize: 13, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{stage}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>

          {/* Overdue */}
          {overdue.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#F87171', marginBottom: 10 }}>
                ⚠ {overdue.length} Overdue follow-up{overdue.length > 1 ? 's' : ''}
              </div>
              {overdue.slice(0, 4).map(l => (
                <Link key={l.id} href={`/leads/${l.id}`} style={{ display: 'block', fontSize: 13, color: 'var(--text)', textDecoration: 'none', marginBottom: 6, padding: '6px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.05)' }}>
                  {fullName(l)}
                  <span style={{ color: '#F87171', fontSize: 11, marginLeft: 6 }}>
                    {l.next_step_due ? new Date(l.next_step_due).toLocaleDateString() : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Quick add lead */}
          <Link href="/leads?new=1" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px', background: 'var(--primary)', borderRadius: 10,
            color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14,
          }}>
            + Add Lead
          </Link>
        </div>
      </div>

      {/* Compose Modal */}
      {quickLead && quickMode && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
        }} onClick={closeQuick}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 24, width: 440, maxWidth: '90vw',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {quickMode === 'sms' ? '💬 Quick SMS' : '✉ Quick Email'} — {fullName(quickLead)}
              </span>
              <button onClick={closeQuick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickMode === 'email' && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Subject</label>
                  <input value={quickSubject} onChange={e => setQuickSubject(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none' }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Message</label>
                <textarea value={quickBody} onChange={e => setQuickBody(e.target.value)} rows={4}
                  placeholder={quickMode === 'sms' ? 'Type your SMS…' : 'Type your email body…'}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
              </div>
              {quickMsg && <p style={{ fontSize: 13, color: quickMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{quickMsg}</p>}
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
