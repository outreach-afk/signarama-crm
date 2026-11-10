'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Lead } from '@/types/database'
import { apolloMatch, fullName, sentiment, timeAgo } from '@/lib/leads'
import { ChannelPill, Pill, card, h1, hasTag, isWarm, sub, useLeads } from '@/components/LeadBits'

const DAY = 86_400_000
const inquiryText = (l: Lead) => (l.notes || '').startsWith('Inquiry: ') ? l.notes!.slice(9).split('\n\n')[0] : null

export default function TodayClient() {
  const { leads, isLoading, setStage, patch } = useLeads()
  const [now] = useState(() => Date.now())
  const open = (l: Lead) => l.stage === 'new'
  const age = (l: Lead) => now - new Date(l.created_at).getTime()

  const sections: { key: string; title: string; why: string; color: string; items: Lead[] }[] = [
    {
      key: 'inquiry', title: 'New inquiries to answer', color: '#10B981',
      why: 'They asked for a quote and nobody has marked them contacted. Fastest reply wins the job.',
      items: leads.filter(l => l.source_subtype === 'inquiry' && open(l) && age(l) < 30 * DAY),
    },
    {
      key: 'replied', title: 'Replies waiting on us', color: '#F59E0B',
      why: 'Replied to outreach with a positive or neutral tone and is still in "new".',
      items: leads.filter(l => l.source === 'revscale' && hasTag(l, 'rs:replied') && open(l) && sentiment(l)?.tone !== 'negative'),
    },
    {
      key: 'apollo', title: 'Apollo outreach that came back warm', color: '#EC4899',
      why: 'We cold-emailed them from Apollo and they then showed up on the website or sent an inquiry.',
      items: leads.filter(l => isWarm(l) && apolloMatch(l) === 'yes' && open(l)),
    },
    {
      key: 'pixel', title: 'Website visitors who opened our email', color: '#3B82F6',
      why: 'Identified by the pixel in the last 14 days and opened the follow-up email. Worth a call.',
      items: leads.filter(l => l.source_subtype === 'web_pixel' && hasTag(l, 'rs:email_opened') && open(l) && age(l) < 14 * DAY),
    },
    {
      key: 'overdue', title: 'Overdue next steps', color: '#EF4444',
      why: 'A next step was scheduled and the date has passed.',
      items: leads.filter(l => l.next_step_due && new Date(l.next_step_due).getTime() < now && !['won', 'completed', 'lost'].includes(l.stage)),
    },
  ]
  // A lead only appears in the first section it qualifies for.
  const seen = new Set<string>()
  for (const s of sections) { s.items = s.items.filter(l => !seen.has(l.id)); s.items.forEach(l => seen.add(l.id)) }
  const total = seen.size

  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      <h1 style={h1}>Today</h1>
      <p style={{ ...sub, marginBottom: 24 }}>
        {isLoading ? 'Loading…' : total === 0 ? 'Nothing waiting. Every warm lead has been handled.' : `${total} lead${total === 1 ? '' : 's'} need a follow-up, most urgent first.`}
      </p>

      {sections.filter(s => s.items.length).map(s => (
        <div key={s.key} style={{ ...card, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{s.title} <span style={{ color: s.color, marginLeft: 6 }}>{s.items.length}</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{s.why}</div>
          </div>
          {s.items.slice(0, 25).map(l => {
            const q = inquiryText(l)
            const mood = sentiment(l)
            return (
              <div key={l.id} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <Link href={`/leads/${l.id}`} style={{ flex: 1, minWidth: 260, textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{fullName(l)}</span>
                    {l.company && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.company}</span>}
                    <ChannelPill lead={l} />
                    {mood && <Pill color={mood.tone === 'positive' ? '#34D399' : '#FCD34D'}>↩ {mood.label}</Pill>}
                    {hasTag(l, 'rs:qualified') && <Pill color="#34D399">Qualified</Pill>}
                  </div>
                  {q && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{q}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, opacity: 0.8 }}>
                    {timeAgo(l.created_at)}{l.email ? ` · ${l.email}` : ''}{l.phone ? ` · ${l.phone}` : ''}
                  </div>
                </Link>
                <div style={{ display: 'flex', gap: 6 }}>
                  {l.phone && <a href={`tel:${l.phone}`} style={btn('#10B981')}>📞 Call</a>}
                  <Link href={`/leads/${l.id}`} style={btn('#3B82F6')}>Open</Link>
                  <button onClick={() => setStage(l, 'contacted')} style={{ ...btn('#F59E0B'), cursor: 'pointer' }}>✓ Contacted</button>
                  {s.key === 'overdue'
                    ? <button onClick={() => patch(l, { next_step_due: null })} style={{ ...btn('#64748B'), cursor: 'pointer' }}>Clear date</button>
                    : <button onClick={() => setStage(l, 'lost')} title="Not a real opportunity" style={{ ...btn('#64748B'), cursor: 'pointer' }}>Dismiss</button>}
                </div>
              </div>
            )
          })}
          {s.items.length > 25 && (
            <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-secondary)' }}>+ {s.items.length - 25} more — work the top of the list first.</div>
          )}
        </div>
      ))}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    padding: '6px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
    background: `${color}18`, color, border: `1px solid ${color}40`,
  }
}
