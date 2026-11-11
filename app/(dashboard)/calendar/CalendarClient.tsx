'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Lead } from '@/types/database'
import { fullName } from '@/lib/leads'
import type { FollowUp } from '@/lib/cadence'
import { ChannelPill, DUE_COLOR, card, h1, sub, useFollowUps, useLeads } from '@/components/LeadBits'

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const CH_COLOR: Record<string, string> = { inquiry: '#10B981', web_pixel: '#3B82F6' }

export default function CalendarClient() {
  const { leads, isLoading } = useLeads()
  const { followUps } = useFollowUps(leads)
  const [today] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [picked, setPicked] = useState<string>(key(today))

  // Each lead sits on the day its next follow-up is due. Anything overdue is shown on today.
  const byDay = useMemo(() => {
    const m = new Map<string, { l: Lead; f: FollowUp }[]>()
    for (const l of leads) {
      const f = followUps.get(l.id)
      if (!f || !f.dueAt || f.state === 'backlog') continue
      const d = f.state === 'overdue' ? today : new Date(f.dueAt)
      const k = key(d)
      const arr = m.get(k); if (arr) arr.push({ l, f }); else m.set(k, [{ l, f }])
    }
    return m
  }, [leads, followUps, today])

  const cells = useMemo(() => {
    const first = new Date(month)
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)) // Monday start
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [month])

  const list = byDay.get(picked) || []
  const pickedDate = cells.find(c => key(c) === picked)
  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))
  const nav: React.CSSProperties = { display: 'inline-flex', padding: 7, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer' }

  return (
    <div style={{ padding: 32, maxWidth: 1240 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={h1}>Calendar</h1>
          <p style={sub}>When each lead needs attention next, from the follow-up playbook and any dates set by hand.{isLoading ? ' Loading…' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={nav} onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <div style={{ minWidth: 150, textAlign: 'center', fontWeight: 700 }}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
          <button style={nav} onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></button>
          <button style={{ ...nav, padding: '7px 12px', fontSize: 13, fontWeight: 600 }} onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setPicked(key(today)) }}>Today</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} style={{ padding: '9px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.map(d => {
              const k = key(d), items = byDay.get(k) || []
              const inMonth = d.getMonth() === month.getMonth()
              const isToday = k === key(today), isPicked = k === picked
              const overdue = isToday ? items.filter(x => x.f.state === 'overdue').length : 0
              return (
                <button key={k} onClick={() => setPicked(k)}
                  style={{
                    minHeight: 92, padding: 8, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5,
                    background: isPicked ? 'var(--primary-dim)' : 'transparent', color: 'var(--text)',
                    border: 'none', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                    opacity: inMonth ? 1 : 0.35,
                  }}>
                  <span style={{
                    fontSize: 12, fontWeight: isToday ? 800 : 500, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 99,
                    background: isToday ? 'var(--primary)' : 'transparent', color: isToday ? '#fff' : 'inherit',
                  }}>{d.getDate()}</span>
                  {items.length > 0 && (
                    <>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{items.length} due{overdue ? <span style={{ color: '#EF4444', fontWeight: 600 }}> · {overdue} late</span> : null}</span>
                      <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {items.slice(0, 10).map(({ l }) => (
                          <i key={l.id} style={{ width: 7, height: 7, borderRadius: 99, background: l.stage === 'quoted' || l.stage === 'negotiating' ? '#A78BFA' : CH_COLOR[l.source_subtype || ''] || '#94A3B8' }} />
                        ))}
                      </span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, padding: '10px 14px', fontSize: 11.5, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            {[['#10B981', 'Inquiry'], ['#3B82F6', 'Web Pixel'], ['#A78BFA', 'Quote sent'], ['#94A3B8', 'Other']].map(([c, t]) => (
              <span key={t}><i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: c, marginRight: 6 }} />{t}</span>
            ))}
          </div>
        </div>

        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>
            {pickedDate ? pickedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Pick a day'}
            <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 8 }}>{list.length}</span>
          </div>
          {list.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--text-secondary)' }}>Nothing due.</div>}
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {list.map(({ l, f }) => (
              <Link key={l.id} href={`/leads/${l.id}`} style={{ display: 'block', padding: '11px 16px', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{fullName(l)}</span>
                  <ChannelPill lead={l} />
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {f.label}{f.state === 'overdue' && <span style={{ color: DUE_COLOR.overdue }}> · {f.daysOverdue}d overdue</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
