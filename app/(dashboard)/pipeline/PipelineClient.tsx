'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Lead, Stage } from '@/types/database'
import { fullName, timeAgo } from '@/lib/leads'
import { ChannelPill, STAGES, STAGE_COLOR, h1, isWarm, sub, useLeads } from '@/components/LeadBits'

const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n}`)

export default function PipelineClient() {
  const { leads, isLoading, setStage, patch } = useLeads()
  const [scope, setScope] = useState<'warm' | 'all'>('warm')
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Stage | null>(null)

  // "New" would hold thousands of cold contacts, so it only ever shows warm leads.
  const board = leads.filter(l => (l.stage === 'new' ? isWarm(l) : scope === 'all' || isWarm(l) || l.source !== 'apollo'))
  const by = (s: Stage) => board.filter(l => l.stage === s)
  const openValue = board.filter(l => !['won', 'completed', 'lost'].includes(l.stage)).reduce((t, l) => t + (l.deal_value || 0), 0)
  const wonValue = board.filter(l => ['won', 'completed'].includes(l.stage)).reduce((t, l) => t + (l.deal_value || 0), 0)

  function drop(stage: Stage) {
    const lead = leads.find(l => l.id === dragId)
    setDragId(null); setOver(null)
    if (lead) setStage(lead, stage)
  }

  function editValue(l: Lead) {
    const raw = window.prompt(`Deal value for ${fullName(l)} ($)`, l.deal_value ? String(l.deal_value) : '')
    if (raw === null) return
    const n = Number(raw.replace(/[^0-9.]/g, ''))
    patch(l, { deal_value: raw.trim() && Number.isFinite(n) ? n : null })
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={h1}>Pipeline</h1>
          <p style={sub}>Drag a card to move it to another stage. Click the amount to set the deal value.</p>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Open <b style={{ color: '#F59E0B', fontSize: 15 }}>{money(openValue)}</b></div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Won <b style={{ color: '#34D399', fontSize: 15 }}>{money(wonValue)}</b></div>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {(['warm', 'all'] as const).map(k => (
              <button key={k} onClick={() => setScope(k)} style={{
                padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: scope === k ? 'var(--primary-dim)' : 'transparent', color: scope === k ? 'var(--primary)' : 'var(--text-secondary)',
              }}>{k === 'warm' ? 'Warm + manual' : 'Include Apollo'}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
        {STAGES.map(stage => {
          const items = by(stage)
          const value = items.reduce((t, l) => t + (l.deal_value || 0), 0)
          const color = STAGE_COLOR[stage]
          return (
            <div key={stage}
              onDragOver={e => { e.preventDefault(); setOver(stage) }}
              onDragLeave={() => setOver(o => (o === stage ? null : o))}
              onDrop={() => drop(stage)}
              style={{
                flex: '0 0 250px', background: over === stage ? `${color}14` : 'var(--surface)', borderRadius: 12,
                border: `1px solid ${over === stage ? color : 'var(--border)'}`, transition: 'background .12s, border-color .12s',
              }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>{stage}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{items.length}{value ? ` · ${money(value)}` : ''}</span>
              </div>
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '68vh', overflowY: 'auto', minHeight: 60 }}>
                {items.slice(0, 60).map(l => (
                  <div key={l.id} draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => { setDragId(null); setOver(null) }}
                    style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 11px',
                      cursor: 'grab', opacity: dragId === l.id ? 0.4 : 1,
                    }}>
                    <Link href={`/leads/${l.id}`} draggable={false} style={{ textDecoration: 'none', color: 'inherit', fontWeight: 600, fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fullName(l)}
                    </Link>
                    {l.company && <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{l.company}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 6 }}>
                      <ChannelPill lead={l} />
                      <button onClick={() => editValue(l)} title="Set deal value"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: l.deal_value ? '#F59E0B' : 'var(--text-secondary)', padding: 0 }}>
                        {l.deal_value ? money(l.deal_value) : '+ $'}
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, opacity: 0.8 }}>{timeAgo(l.created_at)}</div>
                  </div>
                ))}
                {items.length > 60 && <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', padding: 6 }}>+ {items.length - 60} more in Leads</div>}
                {!items.length && <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', padding: '14px 0', opacity: 0.6 }}>{isLoading ? 'Loading…' : 'Drop here'}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
