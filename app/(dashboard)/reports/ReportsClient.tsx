'use client'

import { useMemo, useState } from 'react'
import type { Lead } from '@/types/database'
import { CHANNELS, alsoPixel, apolloMatch, inquiryAt } from '@/lib/leads'
import { card, h1, hasTag, isWarm, sub, useLeads } from '@/components/LeadBits'

const WEEK = 7 * 86_400_000
const WEEKS = 8

function weekStart(ms: number) { // Monday 00:00 local
  const d = new Date(ms); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const monthLabel = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })

export default function ReportsClient() {
  const { leads, isLoading } = useLeads()
  const [now] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  const [period, setPeriod] = useState<'week' | 'month'>('week')

  // Buckets: 8 weeks (Monday start) or 12 calendar months. A person who was identified by the pixel
  // and later sent an inquiry is one lead; it counts once as a pixel visitor (when first seen) and once as an inquiry (when it arrived).
  const build = (kind: 'week' | 'month') => {
    const n = kind === 'week' ? WEEKS : 12
    const starts = Array.from({ length: n }, (_, i) => {
      if (kind === 'week') return weekStart(now) - (n - 1 - i) * WEEK
      const d = new Date(now); return new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1).getTime()
    })
    const rows = starts.map(start => ({ start, pixel: 0, inquiry: 0, apollo: 0, qualified: 0 }))
    const idx = (iso: string) => {
      const t = new Date(iso).getTime()
      if (kind === 'week') { const i = Math.floor((weekStart(t) - starts[0]) / WEEK); return i >= 0 && i < n ? i : -1 }
      const d = new Date(t); return starts.indexOf(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
    }
    for (const l of leads) {
      if (!isWarm(l)) continue
      if (l.source_subtype === 'web_pixel' || alsoPixel(l)) { const i = idx(l.created_at); if (i >= 0) rows[i].pixel++ }
      const at = inquiryAt(l)
      if (at) {
        const i = idx(at)
        if (i >= 0) {
          rows[i].inquiry++
          if (hasTag(l, 'rs:qualified') || hasTag(l, 'rs:partially_qualified')) rows[i].qualified++
        }
      }
      if (apolloMatch(l) === 'yes') { const i = idx(inquiryAt(l) || l.created_at); if (i >= 0) rows[i].apollo++ }
    }
    return rows
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weekRows = useMemo(() => build('week'), [leads, now])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monthRows = useMemo(() => build('month'), [leads, now])
  const weeks = period === 'week' ? weekRows : monthRows
  const N = weeks.length
  const unit = period === 'week' ? 'week' : 'month'

  const channels = useMemo(() => {
    const groups: { key: string; name: string; color: string; match: (l: Lead) => boolean }[] = [
      { key: 'web_pixel', name: 'Revscale · Web Pixel', color: CHANNELS.web_pixel.color, match: l => l.source_subtype === 'web_pixel' },
      { key: 'inquiry', name: 'Revscale · Inquiry', color: CHANNELS.inquiry.color, match: l => l.source_subtype === 'inquiry' },
      { key: 'apollo_warm', name: 'Apollo outreach → warm', color: '#EC4899', match: l => isWarm(l) && apolloMatch(l) === 'yes' },
      { key: 'linkedin', name: 'Revscale · LinkedIn (cold)', color: CHANNELS.linkedin_outbound.color, match: l => l.source_subtype === 'linkedin_outbound' },
      { key: 'apollo', name: 'Apollo contacts (cold)', color: '#F59E0B', match: l => l.source === 'apollo' },
    ]
    return groups.map(g => {
      const ls = leads.filter(g.match)
      const worked = ls.filter(l => l.stage !== 'new').length
      const quoted = ls.filter(l => ['quoted', 'negotiating', 'won', 'completed'].includes(l.stage)).length
      const won = ls.filter(l => ['won', 'completed'].includes(l.stage))
      return { ...g, total: ls.length, worked, quoted, won: won.length, revenue: won.reduce((t, l) => t + (l.deal_value || 0), 0) }
    })
  }, [leads])

  const label = period === 'week' ? dayLabel : monthLabel
  const max = Math.max(1, ...weeks.map(w => w.pixel + w.inquiry))
  const cur = weeks[N - 1], prev = weeks[N - 2]
  const wk = weekRows[WEEKS - 1], wkPrev = weekRows[WEEKS - 2], mo = monthRows[11], moPrev = monthRows[10]
  const avgWeek = Math.round((weekRows.reduce((t, w) => t + w.inquiry, 0) / WEEKS) * 10) / 10
  const delta = (a: number, b: number) => (a === b ? 'flat' : `${a > b ? '+' : ''}${a - b} vs last ${unit}`)

  const summary = [
    `Signarama Corona — warm lead summary, ${period === 'week' ? `week of ${label(cur.start)}` : new Date(cur.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
    `Web Pixel visitors identified: ${cur.pixel} (${delta(cur.pixel, prev.pixel)})`,
    `Inquiries received: ${cur.inquiry} (${delta(cur.inquiry, prev.inquiry)})`,
    `Warm leads that came from Apollo outreach: ${cur.apollo}`,
    `Inquiries qualified or partly qualified by Revscale: ${cur.qualified}`,
    `Last ${N} ${unit}s: ${weeks.reduce((t, w) => t + w.pixel, 0)} pixel, ${weeks.reduce((t, w) => t + w.inquiry, 0)} inquiries.`,
  ].join('\n')

  async function copy() {
    try { await navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ }
  }

  const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }
  const td: React.CSSProperties = { padding: '10px 16px', textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }

  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={h1}>Reports</h1>
          <p style={sub}>Inquiries and website visitors per week and per month, and how each channel converts. Weeks start on Monday.{isLoading ? ' Loading…' : ''}</p>
        </div>
        <button onClick={copy} style={{ padding: '9px 16px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          {copied ? '✓ Copied' : `Copy this ${unit}’s summary`}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 20 }}>
        {[
          { t: 'Inquiries this week', v: wk.inquiry, s: `${wkPrev.inquiry} last week` },
          { t: 'Inquiries this month', v: mo.inquiry, s: `${moPrev.inquiry} last month` },
          { t: 'Average per week', v: avgWeek, s: `over the last ${WEEKS} weeks` },
          { t: 'Website visitors this month', v: mo.pixel, s: `${moPrev.pixel} last month` },
        ].map(k => (
          <div key={k.t} style={{ ...card, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.t}</div>
            <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{k.v}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Warm leads per {unit}</span>
            <span style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {(['week', 'month'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: period === p ? 'var(--primary)' : 'transparent', color: period === p ? '#fff' : 'var(--text-secondary)' }}>
                  {p === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </span>
          </span>
          <span style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CHANNELS.web_pixel.color, marginRight: 6 }} />Web Pixel</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CHANNELS.inquiry.color, marginRight: 6 }} />Inquiry</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 190 }}>
          {weeks.map(w => {
            const t = w.pixel + w.inquiry
            return (
              <div key={w.start} title={`${label(w.start)}: ${w.pixel} pixel, ${w.inquiry} inquiries`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{t || ''}</span>
                <div style={{ width: '100%', maxWidth: 46, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {w.inquiry > 0 && <div style={{ height: (w.inquiry / max) * 140, background: CHANNELS.inquiry.color, borderRadius: '4px 4px 0 0' }} />}
                  {w.pixel > 0 && <div style={{ height: (w.pixel / max) * 140, background: CHANNELS.web_pixel.color, borderRadius: w.inquiry ? 0 : '4px 4px 0 0' }} />}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label(w.start)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ ...th, textAlign: 'left' }}>{period === 'week' ? 'Week of' : 'Month'}</th><th style={th}>Web Pixel</th><th style={th}>Inquiries</th><th style={th}>Total warm</th><th style={th}>From Apollo</th><th style={th}>Qualified</th>
          </tr></thead>
          <tbody>
            {[...weeks].reverse().map((w, i) => (
              <tr key={w.start} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: i === 0 ? 700 : 400 }}>{label(w.start)}{i === 0 ? ` (this ${unit})` : ''}</td>
                <td style={td}>{w.pixel}</td><td style={td}>{w.inquiry}</td><td style={{ ...td, fontWeight: 700 }}>{w.pixel + w.inquiry}</td><td style={td}>{w.apollo}</td><td style={td}>{w.qualified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>
          Conversion by channel <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-secondary)' }}>· all time, from the stages set in this CRM</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ ...th, textAlign: 'left' }}>Channel</th><th style={th}>Leads</th><th style={th}>Worked</th><th style={th}>Quoted+</th><th style={th}>Won</th><th style={th}>Revenue</th>
          </tr></thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...td, textAlign: 'left' }}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.color, marginRight: 8 }} />{c.name}</td>
                <td style={td}>{c.total.toLocaleString()}</td>
                <td style={td}>{c.worked}{c.total ? ` (${Math.round((c.worked / c.total) * 100)}%)` : ''}</td>
                <td style={td}>{c.quoted}</td><td style={td}>{c.won}</td>
                <td style={td}>{c.revenue ? `$${c.revenue.toLocaleString()}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
