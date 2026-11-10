'use client'

import { useState } from 'react'
import { runApolloSync } from '@/lib/leads'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px', marginBottom: 20 }}>
    <h3 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 16, fontWeight: 700, marginBottom: 18 }}>{title}</h3>
    {children}
  </div>
)

const StatusDot = ({ ok }: { ok?: boolean }) => (
  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--text-muted)', marginRight: 6 }} />
)

export default function SettingsClient() {
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<Record<string, string>>({})

  async function triggerSync(source: string) {
    setSyncing(source)
    setSyncMsg(m => ({ ...m, [source]: '' }))
    try {
      if (source === 'apollo') {
        const d = await runApolloSync(msg => setSyncMsg(m => ({ ...m, apollo: msg })))
        setSyncMsg(m => ({ ...m, apollo: `✓ Synced ${d.imported.toLocaleString()} contacts · ${d.matchedToRevscale ?? 0} reached Revscale` }))
      } else {
        const res = await fetch('/api/leads/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) })
        const data = await res.json()
        setSyncMsg(m => ({ ...m, [source]: data.error
          ? `✗ ${data.error}`
          : `✓ ${data.total} Revscale leads · last synced ${data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : 'never'} · ${data.matchedToApollo} matched to Apollo` }))
      }
    } catch {
      setSyncMsg(m => ({ ...m, [source]: '✗ Sync failed' }))
    } finally {
      setSyncing(null)
    }
  }

  const integrations = [
    { key: 'apollo', name: 'Apollo.io', desc: 'Cold outreach contacts. Pulled on demand and once a day.', icon: '🚀' },
    { key: 'revscale', name: 'Revscale AI', desc: 'Warm leads (Web Pixel + Inquiry). Pushed in automatically every hour; this button re-checks freshness and the Apollo match.', icon: '🎯' },
  ]

  const envStatus = [
    { label: 'Supabase', keys: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] },
    { label: 'RingCentral SMS', keys: ['RINGCENTRAL_JWT_TOKEN', 'RINGCENTRAL_CLIENT_ID'] },
    { label: 'Gmail', keys: ['GMAIL_REFRESH_TOKEN', 'GMAIL_CLIENT_ID'] },
    { label: 'Apollo.io', keys: ['APOLLO_API_KEY'] },
    { label: 'Revscale', keys: ['REVSCALE_API_KEY'] },
    { label: 'Slack', keys: ['SLACK_BOT_TOKEN'] },
  ]

  return (
    <div style={{ padding: '32px', maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Manage integrations and team configuration.</p>
      </div>

      <Section title="Lead Sync">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.6 }}>
          Pull leads from Apollo and Revscale into your CRM. Existing leads are matched by ID and updated — no duplicates.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {integrations.map(({ key, name, desc, icon }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 22 }}>{icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{desc}</div>
                  {syncMsg[key] && <div style={{ fontSize: 12, marginTop: 4, color: syncMsg[key].startsWith('✗') ? 'var(--danger)' : syncMsg[key].startsWith('✓') ? 'var(--success)' : 'var(--text-secondary)' }}>{syncMsg[key]}</div>}
                </div>
              </div>
              <button onClick={() => triggerSync(key)} disabled={syncing === key}
                style={{ padding: '7px 14px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 12, cursor: syncing === key ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: syncing === key ? 0.7 : 1 }}>
                {syncing === key ? 'Working…' : key === 'revscale' ? 'Check Now' : 'Sync Now'}
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Environment Variables">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
          Configure these in your Vercel project settings under <strong>Environment Variables</strong>, or in <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>.env.local</code> for local development. See <code>.env.local.example</code> for the full list.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {envStatus.map(({ label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <StatusDot />
              <span style={{ color: 'var(--text-secondary)', width: 150 }}>{label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Set via Vercel dashboard → Environment Variables</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="SMS — RingCentral">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 10 }}>SMS is sent from <strong style={{ color: 'var(--text)' }}>+1 (951) 444-7229</strong> via your RingCentral account using JWT auth.</p>
          <p>Required env vars: <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>RINGCENTRAL_JWT_TOKEN</code>, <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>RINGCENTRAL_CLIENT_ID</code>, <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>RINGCENTRAL_CLIENT_SECRET</code></p>
        </div>
      </Section>

      <Section title="Email — Gmail">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 10 }}>Emails are sent from <strong style={{ color: 'var(--text)' }}>outreach@signarama-corona.com</strong> via the Gmail API.</p>
          <p>Required env vars: <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>GMAIL_CLIENT_ID</code>, <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>GMAIL_CLIENT_SECRET</code>, <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>GMAIL_REFRESH_TOKEN</code></p>
          <p style={{ marginTop: 10 }}>To get a refresh token: use Google OAuth Playground at <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>developers.google.com/oauthplayground</a> with the Gmail Send scope.</p>
        </div>
      </Section>
    </div>
  )
}
