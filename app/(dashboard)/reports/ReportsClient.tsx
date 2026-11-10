'use client'

import { useMemo, useState } from 'react'
import type { Lead } from '@/types/database'
import { CHANNELS, apolloMatch } from '@/lib/leads'
import { card, h1, hasTag, isWarm, sub, useLeads } from '@/components/LeadBits'

const WEEK = 7 * 86_400_000
const WEEKS = 8

function weekStart(ms: number) { // Monday 00:00 local
  const d = new Date(ms); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}
const label = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function ReportsClient() {
  const { leads, isLoading } = useLeads()
  const [now] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  const weeks = useMemo(() => {
    const first = weekStart(now) - (WEEKS - 1) * WEEK
    const rows = Array.from({ length: WEEKS }, (_, i) => ({ start: first + i * WEEK, pixel: 0, inquiry: 0, apollo: 0, qualified: 0 }))
    for (const l of leads) {
      if (!isWarm(l)) continue
      const i = Math.floor((weekStart(new Date(l.created_at).getTime()) - first) / WEEK)
      if (i < 0 || i >= WEEKS) continue
      if (l.source_subtype === 'web_pixel') rows[i].pixel++; else rows[i].inquiry++
      if (apolloMatch(l) === 'yes') rows[i].apollo++
      if (hasTag(l, 'rs:qualified') || hasTag(l, 'rs:partially_qualified')) rows[i].qualified++
    }
    return rows
  }, [leads, now])

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

  const max = Math.max(1, ...weeks.map(w => w.pixel + w.inquiry))
  const cur = weeks[WEEKS - 1], prev = weeks[WEEKS - 2]
  const delta = (a: number, b: number) => (a === b ? 'flat' : `${a > b ? '+' : ''}${a - b} vs last week`)

  const summary = [
    `Signarama Corona — warm lead summary, week of ${label(cur.start)}`,
    `Web Pixel visitors identified: ${cur.pixel} (${delta(cur.pixel, prev.pixel)})`,
    `Inquiries received: ${cur.inquiry} (${delta(cur.inquiry, prev.inquiry)})`,
    `Warm leads that came from Apollo outreach: ${cur.apollo}`,
    `Inquiries qualified or partly qualified by Revscale: ${cur.qualified}`,
    `Last ${WEEKS} weeks: ${weeks.reduce((t, w) => t + w.pixel, 0)} pixel, ${weeks.reduce((t, w) => t + w.inquiry, 0)} inquiries.`,
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
          <p style={sub}>Warm leads per week and how each channel converts. Weeks start on Monday.{isLoading ? ' Loading…' : ''}</p>
        </div>
        <button onClick={copy} style={{ padding: '9px 16px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          {copied ? '✓ Copied' : 'Copy this week’s summary'}
        </button>
      </div>

      <div style={{ ...card, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Warm leads per week</span>
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
            <th style={{ ...th, textAlign: 'left' }}>Week of</th><th style={th}>Web Pixel</th><th style={th}>Inquiries</th><th style={th}>Total warm</th><th style={th}>From Apollo</th><th style={th}>Qualified</th>
          </tr></thead>
          <tbody>
            {[...weeks].reverse().map((w, i) => (
              <tr key={w.start} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: i === 0 ? 700 : 400 }}>{label(w.start)}{i === 0 ? ' (this week)' : ''}</td>
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
