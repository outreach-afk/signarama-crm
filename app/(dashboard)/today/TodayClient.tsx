'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Phone, ChevronDown, ChevronRight, Clock, ExternalLink } from 'lucide-react'
import type { Lead } from '@/types/database'
import { fullName, sentiment, timeAgo } from '@/lib/leads'
import { urgency, type FollowUp } from '@/lib/cadence'
import {
  ChannelPill, DUE_COLOR, LogTouch, Pill, card, dueText, h1, hasTag, sub, useFollowUps, useLeads,
} from '@/components/LeadBits'

const DAY = 86_400_000
const inquiryText = (l: Lead) => (l.notes || '').startsWith('Inquiry: ') ? l.notes!.slice(9).split('\n\n')[0] : null
const ICON: Record<string, string> = { call: 'Call', email: 'Email', sms: 'Text' }

function lastLine(f: FollowUp) {
  const parts = (['call', 'email', 'sms'] as const).filter(t => f.last[t]).map(t => `${ICON[t].toLowerCase()} ${timeAgo(f.last[t])}`)
  return parts.length ? `Last ${parts.join(' · ')}` : 'No contact logged yet'
}

export default function TodayClient() {
  const { leads, isLoading, setStage, patch } = useLeads()
  const { followUps, logTouch } = useFollowUps(leads)
  const [openScript, setOpenScript] = useState<string | null>(null)
  const [showSoon, setShowSoon] = useState(false)
  const [limit, setLimit] = useState(30)

  const { now, soon, backlog, replies } = useMemo(() => {
    const now: { l: Lead; f: FollowUp }[] = [], soon: { l: Lead; f: FollowUp }[] = [], backlog: Lead[] = []
    const t = Date.now()
    for (const l of leads) {
      const f = followUps.get(l.id)
      if (!f) continue
      if (f.state === 'overdue' || f.state === 'due') now.push({ l, f })
      else if (f.state === 'backlog') backlog.push(l)
      else if (f.dueAt && f.dueAt - t < 7 * DAY) soon.push({ l, f })
    }
    now.sort((a, b) => urgency(b.l, b.f) - urgency(a.l, a.f) || (a.f.dueAt || 0) - (b.f.dueAt || 0))
    soon.sort((a, b) => (a.f.dueAt || 0) - (b.f.dueAt || 0))
    const inNow = new Set(now.map(x => x.l.id))
    const replies = leads.filter(l => l.source === 'revscale' && hasTag(l, 'rs:replied') && l.stage === 'new' && sentiment(l)?.tone !== 'negative' && !inNow.has(l.id))
    return { now, soon, backlog, replies }
  }, [leads, followUps])

  const snooze = (l: Lead, days: number, f: FollowUp) =>
    patch(l, { next_step_due: new Date(Date.now() + days * DAY).toISOString(), next_step: l.next_step || f.label })

  const row = ({ l, f }: { l: Lead; f: FollowUp }) => {
    const q = inquiryText(l)
    const open = openScript === l.id
    const stepNo = f.step ? `Step ${f.stepIndex + 1} of ${f.cadence.steps.length}` : f.state === 'due' && f.stepIndex >= f.cadence.steps.length ? 'Nurture' : 'Reminder'
    return (
      <div key={l.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Link href={`/leads/${l.id}`} style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', textDecoration: 'none' }}>{fullName(l)}</Link>
              {l.company && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.company}</span>}
              <ChannelPill lead={l} />
              {hasTag(l, 'rs:qualified') && <Pill color="#34D399">Qualified</Pill>}
              <Pill color={DUE_COLOR[f.state]}>{dueText(f)}</Pill>
            </div>
            <button onClick={() => setOpenScript(open ? null : l.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: 0, background: 'none', border: 'none', cursor: f.step ? 'pointer' : 'default', color: 'var(--text)', fontSize: 13, textAlign: 'left' }}>
              {f.step && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
              <span style={{ color: 'var(--text-secondary)' }}>{stepNo}:</span> <b style={{ fontWeight: 600 }}>{f.label}</b>
            </button>
            {open && f.step && (
              <div style={{ margin: '8px 0 2px 20px', padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: 640 }}>
                {f.step.script.replace(/\{first\}/g, l.first_name || 'there').replace(/\{need\}/g, q ? 'your sign project' : 'your project').replace(/\{rep\}/g, '[your name]')}
              </div>
            )}
            {q && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.5, maxWidth: 640 }}>“{q.length > 180 ? `${q.slice(0, 180)}…` : q}”</div>}
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5, opacity: 0.85 }}>
              {lastLine(f)} · arrived {timeAgo(l.created_at)}{l.phone ? ` · ${l.phone}` : ''}{l.email ? ` · ${l.email}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
            {l.phone && <a href={`tel:${l.phone}`} style={btn('#10B981')}><Phone size={12} /> Call</a>}
            <LogTouch compact onLog={(type, outcome) => logTouch(l, type, outcome)} />
            <select value="" onChange={e => { if (e.target.value === 'lost') setStage(l, 'lost'); else if (e.target.value) snooze(l, Number(e.target.value), f) }}
              style={{ ...btn('#64748B'), cursor: 'pointer', appearance: 'none', outline: 'none' }} title="Push this follow-up back, or close the lead">
              <option value="">Later ▾</option>
              <option value="1">Tomorrow</option>
              <option value="3">In 3 days</option>
              <option value="7">Next week</option>
              <option value="lost">Not a real lead</option>
            </select>
            <Link href={`/leads/${l.id}`} style={btn('#3B82F6')}><ExternalLink size={12} /> Open</Link>
          </div>
        </div>
      </div>
    )
  }

  const overdue = now.filter(x => x.f.state === 'overdue').length
  return (
    <div style={{ padding: 32, maxWidth: 1180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={h1}>Today</h1>
          <p style={sub}>
            {isLoading ? 'Loading…' : now.length === 0 ? 'Nothing due. Every active lead has had its follow-up.' :
              `${now.length} follow-up${now.length === 1 ? '' : 's'} to do${overdue ? `, ${overdue} overdue` : ''}. Work from the top: the order is by urgency.`}
          </p>
        </div>
        <Link href="/playbook" style={{ ...btn('#F59E0B'), padding: '9px 14px', fontSize: 13 }}>Follow-up playbook</Link>
      </div>

      {now.length > 0 && (
        <div style={{ ...card, marginBottom: 20, overflow: 'visible' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', borderLeft: '3px solid #F59E0B', borderRadius: '12px 12px 0 0' }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Do now <span style={{ color: '#F59E0B', marginLeft: 6 }}>{now.length}</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Log each call, email or text when you make it. That moves the lead to its next step and off this list.</div>
          </div>
          {now.slice(0, limit).map(row)}
          {now.length > limit && (
            <button onClick={() => setLimit(n => n + 30)} style={{ width: '100%', padding: 12, background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Show 30 more · {now.length - limit} remaining
            </button>
          )}
        </div>
      )}

      {replies.length > 0 && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', borderLeft: '3px solid #34D399', borderRadius: '12px 12px 0 0' }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Replies waiting on us <span style={{ color: '#34D399', marginLeft: 6 }}>{replies.length}</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Replied to LinkedIn outreach with a positive or neutral tone and nobody has picked it up.</div>
          </div>
          {replies.slice(0, 15).map(l => (
            <div key={l.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <Link href={`/leads/${l.id}`} style={{ flex: 1, minWidth: 240, fontWeight: 600, fontSize: 14, color: 'var(--text)', textDecoration: 'none' }}>
                {fullName(l)} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-secondary)' }}>{l.company}</span>
              </Link>
              {sentiment(l) && <Pill color={sentiment(l)!.tone === 'positive' ? '#34D399' : '#FCD34D'}>{sentiment(l)!.label}</Pill>}
              <button onClick={() => setStage(l, 'contacted')} style={{ ...btn('#F59E0B'), cursor: 'pointer' }}>Start follow-up</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, marginBottom: 20 }}>
        <button onClick={() => setShowSoon(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
          {showSoon ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Clock size={15} color="#64748B" />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Coming up in the next 7 days</span>
          <span style={{ color: 'var(--text-secondary)' }}>{soon.length}</span>
          <Link href="/calendar" onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}>Open calendar →</Link>
        </button>
        {showSoon && soon.slice(0, 40).map(({ l, f }) => (
          <Link key={l.id} href={`/leads/${l.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 20px', borderTop: '1px solid var(--border)', textDecoration: 'none', color: 'inherit', flexWrap: 'wrap' }}>
            <span style={{ width: 92, fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(f.dueAt!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span style={{ fontWeight: 600, fontSize: 13.5, minWidth: 180 }}>{fullName(l)}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', flex: 1 }}>{f.label}</span>
            <ChannelPill lead={l} />
          </Link>
        ))}
      </div>

      {backlog.length > 0 && (
        <div style={{ ...card, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Backlog <span style={{ color: '#94A3B8', marginLeft: 6 }}>{backlog.length}</span></div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>
              Warm leads older than 30 days with no contact logged. They are not in the daily list because chasing a three-month-old inquiry as if it were new does not work.
              Send one re-engagement email to each (log it and it enters the monthly nurture), or mark it lost.
            </div>
          </div>
          <Link href="/leads?view=revscale&channel=inquiry" style={{ ...btn('#3B82F6'), padding: '9px 14px', fontSize: 13 }}>Review inquiries</Link>
        </div>
      )}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 9px', borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
    background: `${color}18`, color, border: `1px solid ${color}40`,
  }
}
