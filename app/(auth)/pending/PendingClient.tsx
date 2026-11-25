'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function PendingClient() {
  const router = useRouter()
  const [status, setStatus] = useState<string>('pending')
  useEffect(() => {
    fetch('/api/access/request', { method: 'POST' }).then(r => r.json()).then(d => {
      if (d.status && d.status !== 'pending' && d.status !== 'denied') router.replace('/today')
      else if (d.status) setStatus(d.status)
    }).catch(() => {})
  }, [router])
  async function signOut() { await createClient().auth.signOut(); router.replace('/login') }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--bg)' }}>
      <div style={{ maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '28px 26px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 21, fontWeight: 700, marginBottom: 10 }}>
          {status === 'denied' ? 'Access not approved' : 'Waiting for approval'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
          {status === 'denied'
            ? 'Your request to use the Signarama Corona CRM was not approved. Contact Orlando if you think this is a mistake.'
            : 'Your account is created. Orlando has been notified and will review your request. Once approved, sign in again and the CRM will open.'}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
          {status !== 'denied' && <button onClick={() => location.reload()} style={{ padding: '8px 14px', background: 'var(--primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Check again</button>}
          <button onClick={signOut} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
