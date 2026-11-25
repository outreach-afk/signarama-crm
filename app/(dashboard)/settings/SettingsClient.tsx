'use client'

import { useEffect, useState } from 'react'
import { runApolloSync } from '@/lib/leads'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useRouting, useTeam } from '@/components/LeadBits'
import { TEAM_KEY, type TeamSettings } from '@/lib/team'
import { DEFAULT_WELCOME, ROUTING_KEY, type RoutingSettings } from '@/lib/opportunity'
import { DEFAULT_SIGNATURE, DEFAULT_SIGNATURE_HTML, SIGNATURE_KEY, type Signature } from '@/lib/signature'
import { CADENCES } from '@/lib/cadence'

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
  const { viewOnly } = useTeam()
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

  if (viewOnly) return (
    <div style={{ padding: '32px', maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Settings</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>You have view-only access, so settings are not available. Ask Orlando if you need to edit.</p>
    </div>
  )

  return (
    <div style={{ padding: '32px', maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Manage integrations and team configuration.</p>
      </div>

      <Section title="Connections">
        <Connections />
      </Section>

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

      <Section title="Follow-up team">
        <TeamSettingsForm />
      </Section>

      <Section title="Team access">
        <TeamAccess />
      </Section>

      <Section title="Email signature">
        <SignatureForm />
      </Section>

      <Section title="Lead routing and welcome text">
        <RoutingForm />
      </Section>

      <Section title="Follow-ups in your own calendar">
        <CalendarFeed />
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

function CalendarFeed() {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { fetch('/api/calendar/link').then(r => r.json()).then(d => setUrl(d.url || '')).catch(() => {}) }, [])
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* select the text instead */ } }
  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
      <p style={{ marginBottom: 12 }}>
        Subscribe to this address in Google Calendar (Other calendars → From URL) or Outlook (Add calendar → Subscribe from web).
        Each day gets one entry listing the follow-ups due, with phone numbers. Google refreshes subscribed calendars a few times a day, so use the Today page for the live list.
        Anyone with this address can read the list, so share it only with the team.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input readOnly value={url || 'Loading…'} onFocus={e => e.currentTarget.select()}
          style={{ flex: 1, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, outline: 'none' }} />
        <button onClick={copy} disabled={!url} style={{ padding: '7px 14px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
    </div>
  )
}

function TeamSettingsForm() {
  const team = useTeam()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<TeamSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const v = draft || team.settings
  const set = (k: Partial<TeamSettings>) => setDraft({ ...v, ...k })
  const steps = CADENCES.inquiry.steps

  async function save() {
    setBusy(true); setMsg('')
    const { error } = await createClient().from('app_settings').upsert({ key: TEAM_KEY, value: v, updated_at: new Date().toISOString() } as never)
    setBusy(false)
    if (error) { setMsg(`✗ ${error.message}`); return }
    setDraft(null); setMsg('✓ Saved'); qc.invalidateQueries({ queryKey: ['team'] })
  }
  async function assign() {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/team/assign', { method: 'POST' })
      const d = await r.json()
      setMsg(d.error ? `✗ ${d.error}` : d.message ? `✓ ${d.message}` : `✓ ${d.opener} leads given to ${team.name(v.opener)}, ${d.closer} to ${team.name(v.closer)}`)
      qc.invalidateQueries({ queryKey: ['leads'] })
    } finally { setBusy(false) }
  }

  const sel: React.CSSProperties = { padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', minWidth: 180 }
  const lab: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }
  const people = team.profiles
  const meProfile = people.find(p => p.id === team.me)
  const [myName, setMyName] = useState<string | null>(null)
  async function saveName() {
    if (!team.me || myName === null) return
    const { error } = await createClient().from('profiles').update({ full_name: myName.trim() || null } as never).eq('id', team.me)
    setMsg(error ? `✗ ${error.message}` : '✓ Name saved'); setMyName(null); qc.invalidateQueries({ queryKey: ['team'] })
  }

  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div><div style={lab}>Your name in the CRM</div>
          <input value={myName ?? meProfile?.full_name ?? ''} onChange={e => setMyName(e.target.value)} placeholder="First and last name" style={{ ...sel, minWidth: 240 }} /></div>
        <button onClick={saveName} disabled={myName === null} style={{ padding: '8px 14px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Save name</button>
        <span style={{ fontSize: 12 }}>Shown on handoffs, owners and the activity log.</span>
      </div>
      <p style={{ marginBottom: 14 }}>
        Inquiry leads go to the opener, who makes first contact and works the first steps of the playbook. When an inquiry reaches the handoff step it moves to the closer,
        with a short note, and shows up at the top of their Today list. Web Pixel leads go straight to the closer and are never handed off.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div><div style={lab}>Opener</div>
          <select value={v.opener || ''} onChange={e => set({ opener: e.target.value || null })} style={sel}>
            <option value="">Choose…</option>{people.map(p => <option key={p.id} value={p.id}>{team.name(p.id)}</option>)}
          </select></div>
        <div><div style={lab}>Closer</div>
          <select value={v.closer || ''} onChange={e => set({ closer: e.target.value || null })} style={sel}>
            <option value="">Choose…</option>{people.map(p => <option key={p.id} value={p.id}>{team.name(p.id)}</option>)}
          </select></div>
        <div><div style={lab}>Hand off after</div>
          <select value={v.handoffStep} onChange={e => set({ handoffStep: Number(e.target.value) })} style={sel}>
            {steps.map((s, i) => <option key={i} value={i + 1}>Step {i + 1} — {s.title}</option>)}
          </select></div>
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 16, color: 'var(--text)' }}>
        <input type="checkbox" checked={v.handoffOnEngage} onChange={e => set({ handoffOnEngage: e.target.checked })} style={{ marginTop: 3 }} />
        <span>Also hand off as soon as the lead engages
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>A call logged as &ldquo;Spoke with them&rdquo;, or the lead moved to Quoted. The closer gets the lead while it is hot instead of after step {v.handoffStep}.</span>
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={save} disabled={busy || !draft} style={{ padding: '7px 14px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Save</button>
        <button onClick={assign} disabled={busy || !!draft || !team.ready} title={draft ? 'Save first' : ''} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
          Give owners to open warm leads
        </button>
        {msg && <span style={{ fontSize: 12, color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--success)' }}>{msg}</span>}
      </div>
      <p style={{ fontSize: 12, marginTop: 10 }}>Only people who have created an account appear in these lists. A new team member signs up at /register first.</p>
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Can edit', bdr: 'Can edit', viewer: 'View only', pending: 'Waiting', denied: 'Blocked' }

function TeamAccess() {
  const team = useTeam()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  async function setRole(id: string, role: string) {
    setBusy(id); setMsg('')
    const r = await fetch('/api/team/role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role }) })
    const d = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) { setMsg(`✗ ${d.error || 'Could not change access'}`); return }
    setMsg('✓ Saved'); qc.invalidateQueries({ queryKey: ['team'] })
  }
  const waiting = team.everyone.filter(p => p.role === 'pending')
  const rest = team.everyone.filter(p => p.role !== 'pending')
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ padding: '6px 11px', background: bg, border: 'none', borderRadius: 7, color: fg, fontWeight: 600, fontSize: 12, cursor: 'pointer' })
  return (
    <div id="team-access" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <p style={{ marginBottom: 12 }}>
        Anyone can request access at <b style={{ color: 'var(--text)' }}>https://signarama-crm.vercel.app/register</b>, but they see nothing until
        {team.isOwner ? ' you approve them' : ' Orlando (owner) approves them'}. You get an email for each request. Approve as <b style={{ color: 'var(--text)' }}>View only</b> unless they work leads.
        Only the owner can approve, block or change access, so nobody else can let people in.
      </p>
      {waiting.length > 0 && (
        <div style={{ border: '1px solid rgba(245,158,11,0.45)', borderRadius: 8, overflow: 'hidden', maxWidth: 640, marginBottom: 14 }}>
          <div style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.10)', color: '#F59E0B', fontWeight: 600, fontSize: 12.5 }}>Waiting for approval ({waiting.length})</div>
          {waiting.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 180, color: 'var(--text)' }}>{p.full_name || p.email} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.email}</span></span>
              {team.isOwner ? (<>
                <button disabled={busy === p.id} onClick={() => setRole(p.id, 'viewer')} style={btn('#3B82F6')}>Approve · view only</button>
                <button disabled={busy === p.id} onClick={() => setRole(p.id, 'bdr')} style={btn('var(--surface-2)', 'var(--text)')}>Approve · can edit</button>
                <button disabled={busy === p.id} onClick={() => setRole(p.id, 'denied')} style={btn('rgba(239,68,68,0.15)', '#F87171')}>Deny</button>
              </>) : <span style={{ fontSize: 12 }}>Waiting for Orlando</span>}
            </div>
          ))}
        </div>
      )}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxWidth: 640 }}>
        {rest.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
            <span style={{ flex: 1, color: 'var(--text)' }}>{team.name(p.id)} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.email}{p.id === team.me ? ' (you)' : ''}</span></span>
            {team.isOwner && p.role !== 'owner' ? (
              <select value={p.role === 'viewer' || p.role === 'denied' ? p.role : 'bdr'} disabled={busy === p.id} onChange={e => setRole(p.id, e.target.value)}
                style={{ padding: '6px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12.5, outline: 'none' }}>
                <option value="bdr">Can edit</option>
                <option value="viewer">View only</option>
                <option value="denied">Blocked</option>
              </select>
            ) : <span style={{ fontSize: 12.5 }}>{ROLE_LABEL[p.role] || p.role}</span>}
          </div>
        ))}
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 8, color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--success)' }}>{msg}</div>}
    </div>
  )
}

function SignatureForm() {
  const qc = useQueryClient()
  const { data: saved } = useQuery({
    queryKey: ['signature'],
    queryFn: async () => {
      const { data } = await createClient().from('app_settings').select('value').eq('key', SIGNATURE_KEY).maybeSingle()
      return { ...DEFAULT_SIGNATURE, ...(((data as { value?: Partial<Signature> } | null)?.value) || {}) } as Signature
    },
  })
  const [draft, setDraft] = useState<Signature | null>(null)
  const [msg, setMsg] = useState('')
  const v = draft || saved || DEFAULT_SIGNATURE
  async function save() {
    const { error } = await createClient().from('app_settings').upsert({ key: SIGNATURE_KEY, value: v, updated_at: new Date().toISOString() } as never)
    if (error) { setMsg(`✗ ${error.message}`); return }
    setDraft(null); setMsg('✓ Saved'); qc.invalidateQueries({ queryKey: ['signature'] })
  }
  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <p style={{ marginBottom: 12 }}>
        Gmail only adds the signature from Gmail settings when you send from Gmail itself, so the CRM adds this one to every email it sends.
        It is a copy of the outreach@ Gmail signature. If you change the signature in Gmail, paste the new one here too (HTML).
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', marginBottom: 10, color: 'var(--text)' }}>
        <input type="checkbox" checked={v.enabled} onChange={e => setDraft({ ...v, enabled: e.target.checked })} /> Add the signature to emails sent from the CRM
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>Signature (HTML)</div>
          <textarea value={v.html} onChange={e => setDraft({ ...v, html: e.target.value })} rows={9} spellCheck={false}
            style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 11.5, fontFamily: 'ui-monospace, monospace', outline: 'none', resize: 'vertical' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>How it looks</div>
          <div style={{ background: '#ffffff', borderRadius: 7, padding: 14, border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: v.html }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button onClick={save} disabled={!draft} style={{ padding: '7px 14px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: draft ? 1 : 0.5 }}>Save</button>
        <button onClick={() => setDraft({ ...v, html: DEFAULT_SIGNATURE_HTML })} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Reset to Gmail signature</button>
        {msg && <span style={{ fontSize: 12, color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--success)' }}>{msg}</span>}
      </div>
    </div>
  )
}

function RoutingForm() {
  const team = useTeam()
  const saved = useRouting()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<RoutingSettings | null>(null)
  const [msg, setMsg] = useState('')
  const v = draft || saved
  const set = (k: Partial<RoutingSettings>) => setDraft({ ...v, ...k })
  async function save() {
    const { error } = await createClient().from('app_settings').upsert({ key: ROUTING_KEY, value: v, updated_at: new Date().toISOString() } as never)
    if (error) { setMsg(`✗ ${error.message}`); return }
    setDraft(null); setMsg('✓ Saved'); qc.invalidateQueries({ queryKey: ['routing'] })
  }
  const sel: React.CSSProperties = { padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', minWidth: 160 }
  const lab: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }
  const who = (k: 'large' | 'medium' | 'small', label: string, hint: string) => (
    <div><div style={lab}>{label}</div>
      <select value={v[k] || ''} onChange={e => set({ [k]: e.target.value || null } as Partial<RoutingSettings>)} style={sel}>
        <option value="">{k === 'medium' ? 'Follow-up team (opener → closer)' : 'No one'}</option>
        {team.profiles.map(p => <option key={p.id} value={p.id}>{team.name(p.id)}</option>)}
      </select>
      <div style={{ fontSize: 11.5, marginTop: 4, maxWidth: 220 }}>{hint}</div></div>
  )
  const preview = (v.welcomeText || DEFAULT_WELCOME).replace(/\{first\}/g, 'Valeri').replace(/\{about\}/g, ' about stickers / decals').replace(/\{company\}/g, 'AlorAir')
  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <p style={{ marginBottom: 14 }}>
        Every new Inquiry and Web Pixel lead is researched in Apollo, sized from what they asked for (plus company size and any budget they gave),
        and checked for whether the contact is the decision maker. New inquiries then go to the person below for their size.
        Medium jobs keep the normal opener → closer handoff. Existing leads are never moved automatically: their page shows a &ldquo;Give to…&rdquo; button instead.
      </p>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
        {who('large', 'Large jobs', `Estimated at ${'$'}${v.largeMin.toLocaleString()} or more: monument, pylon, illuminated and building signs, fleets, multi-location.`)}
        {who('medium', 'Medium jobs', 'Wraps, window and wall graphics, interior and ADA signs.')}
        {who('small', 'Small jobs', `${'$'}${v.smallMax.toLocaleString()} or less: banners, stickers, yard signs, A-frames. Also handles “not a fit” requests.`)}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
        <div><div style={lab}>Large from ($)</div><input type="number" value={v.largeMin} onChange={e => set({ largeMin: Number(e.target.value) || 0 })} style={{ ...sel, minWidth: 120, width: 120 }} /></div>
        <div><div style={lab}>Small up to ($)</div><input type="number" value={v.smallMax} onChange={e => set({ smallMax: Number(e.target.value) || 0 })} style={{ ...sel, minWidth: 120, width: 120 }} /></div>
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 10, color: 'var(--text)' }}>
        <input type="checkbox" checked={v.autoWelcome} onChange={e => set({ autoWelcome: e.target.checked })} style={{ marginTop: 3 }} />
        <span>Text new inquiries a welcome message automatically
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>
            Sent once from (951) 444-7269 to inquiries with a valid mobile, 8am–7pm Pacific, Monday–Saturday (later ones wait for the morning).
            It is a text, not an email, because Revscale&apos;s Inquiry Qualifier already emails every inquiry within a minute. It does not count as a follow-up step.
          </span></span>
      </label>
      <div style={lab}>Welcome text</div>
      <textarea value={v.welcomeText} onChange={e => set({ welcomeText: e.target.value })} rows={3}
        style={{ width: '100%', maxWidth: 640, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical' }} />
      <div style={{ fontSize: 12, margin: '4px 0 14px', maxWidth: 640 }}>
        {'{first}'} = first name, {'{about}'} = &ldquo; about&nbsp;&lt;what they asked for&gt;&rdquo;, {'{company}'} = their company. Keep &ldquo;Reply STOP to opt out&rdquo;.
        <br /><b style={{ color: 'var(--text)' }}>Preview ({preview.length} characters):</b> {preview}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={save} disabled={!draft} style={{ padding: '7px 14px', background: 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: draft ? 1 : 0.5 }}>Save</button>
        {msg && <span style={{ fontSize: 12, color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--success)' }}>{msg}</span>}
      </div>
    </div>
  )
}

type Diag = {
  gmail?: { tokenStatus?: number; tokenError?: { error?: string }; mailbox?: string; canSend?: boolean; error?: string }
  ringcentral?: { tokenStatus?: number; tokenError?: { error?: string; message?: string }; fromNumber?: string | null; canSendSms?: boolean; error?: string }
  anthropic?: { ok?: boolean; noCredit?: boolean; error?: string }
}

function Connections() {
  const [d, setD] = useState<Diag | null>(null)
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  useEffect(() => { setBanner(new URLSearchParams(window.location.search).get('gmail')) }, [])
  const check = () => { setLoading(true); fetch('/api/diagnostics/messaging').then(r => r.json()).then(setD).catch(() => setD({})).finally(() => setLoading(false)) }
  useEffect(check, [])

  const fmtPhone = (p?: string | null) => (p || '').replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') || '—'
  const rows: { name: string; ok: boolean | null; text: string; fix?: string }[] = d ? [
    {
      name: 'Email (Gmail)',
      ok: d.gmail?.tokenStatus === 200 && d.gmail?.canSend !== false,
      text: d.gmail?.tokenStatus === 200 ? `Connected. Emails send from ${d.gmail?.mailbox}.${d.gmail?.canSend === false ? ' (No send permission: reconnect.)' : ''}`
        : d.gmail?.tokenError?.error === 'invalid_grant' ? 'Disconnected. The saved Gmail login expired or was revoked, so no email can be sent from the CRM.'
        : `Not working${d.gmail?.tokenError?.error ? ` (${d.gmail.tokenError.error})` : ''}.`,
      fix: d.gmail?.tokenStatus === 200 ? undefined : 'Press Connect Gmail and approve with the outreach@ Google account.',
    },
    {
      name: 'Text messages (RingCentral)',
      ok: d.ringcentral?.tokenStatus === 200 && !!d.ringcentral?.canSendSms,
      text: d.ringcentral?.tokenStatus === 200 ? `Connected. Texts send from ${fmtPhone(d.ringcentral?.fromNumber)}.` : `Not working${d.ringcentral?.tokenError?.message ? `: ${d.ringcentral.tokenError.message}` : ''}.`,
      fix: d.ringcentral?.tokenStatus === 200 ? undefined : 'The RingCentral login saved in Vercel was rejected and needs replacing.',
    },
    {
      name: 'AI drafts (Anthropic)',
      ok: !!d.anthropic?.ok,
      text: d.anthropic?.ok ? 'Working. Drafts are written by AI.' : d.anthropic?.noCredit ? 'Out of credit. Drafts fall back to a standard template.' : 'Not working. Drafts fall back to a standard template.',
      fix: d.anthropic?.ok ? undefined : 'Add credit at console.anthropic.com → Plans & Billing.',
    },
  ] : []

  return (
    <div>
      {banner && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13, background: banner.startsWith('connected') ? 'var(--success-dim)' : 'var(--danger-dim)', color: banner.startsWith('connected') ? 'var(--success)' : 'var(--danger)' }}>
          {banner.startsWith('connected') ? `✓ Gmail connected${banner.slice(10) ? ` as ${banner.slice(10)}` : ''}.` : `✗ Gmail was not connected: ${banner.replace(/^error:/, '')}`}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!d && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Checking…</div>}
        {rows.map(r => (
          <div key={r.name} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 99, marginTop: 5, flexShrink: 0, background: r.ok ? 'var(--success)' : 'var(--danger)', boxShadow: `0 0 10px ${r.ok ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'}` }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{r.text}</div>
              {r.fix && <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>{r.fix}</div>}
              {r.name.startsWith('Email') && (
                <a href="/api/gmail/connect" style={{ display: 'inline-block', marginTop: 8, padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none', background: r.ok ? 'transparent' : 'var(--primary)', color: r.ok ? 'var(--text-secondary)' : '#fff', border: r.ok ? '1px solid var(--border)' : 'none' }}>
                  {r.ok ? 'Reconnect Gmail' : 'Connect Gmail'}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      <button onClick={check} disabled={loading} style={{ marginTop: 12, padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
        {loading ? 'Checking…' : 'Check again'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>This check signs in to each service but never sends a message.</p>
    </div>
  )
}
