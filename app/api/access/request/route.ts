import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/sync'
import { accessToken } from '@/lib/gmail'
import { encodeHeader } from '@/lib/messaging'

// Called by the "waiting for approval" page. Emails the owner once per new account.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const db = adminDb()
  const { data: me } = await db.from('profiles').select('role, full_name, email').eq('id', user.id).maybeSingle()
  if (me?.role !== 'pending') return NextResponse.json({ ok: true, status: me?.role || 'unknown' })

  const key = `access_requested:${user.id}`
  const { data: done } = await db.from('private_settings').select('key').eq('key', key).maybeSingle()
  if (done) return NextResponse.json({ ok: true, status: 'pending', notified: 'earlier' })
  const reason = String(user.user_metadata?.access_reason || '').trim()
  await db.from('private_settings').insert([{ key, value: JSON.stringify({ at: new Date().toISOString(), reason }) }])

  const owner = (await db.from('profiles').select('email').eq('role', 'owner').limit(1).maybeSingle()).data?.email || process.env.GMAIL_FROM!
  const who = [me.full_name, me.email].filter(Boolean).join(' · ')
  const text = `${who} signed up for the Signarama CRM and is waiting for your approval.\n\nWhy they want access:\n${reason || '(no reason given)'}\n\nThey can see nothing until you approve them.\nApprove or deny: https://signarama-crm.vercel.app/settings#team-access`
  const t = await accessToken()
  if (t.ok && t.token) {
    const from = process.env.GMAIL_FROM!
    const raw = Buffer.from([
      `From: ${encodeHeader('Signarama CRM')} <${from}>`, `To: ${owner}`, `Subject: ${encodeHeader(`CRM access request: ${me.full_name || me.email}`)}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', text,
    ].join('\r\n')).toString('base64url')
    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
    }).catch(() => null)
  }
  return NextResponse.json({ ok: true, status: 'pending', notified: 'now' })
}
