import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encodeHeader, gmailError } from '@/lib/messaging'
import { accessToken } from '@/lib/gmail'

async function getGmailToken() {
  const r = await accessToken()
  if (!r.ok || !r.token) throw new Error(gmailError(r.status, r.text))
  return r.token
}

function makeRaw(to: string, from: string, subject: string, body: string) {
  const msg = [
    `From: ${encodeHeader('Signarama Corona')} <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n')
  return Buffer.from(msg).toString('base64url')
}

export async function POST(req: NextRequest) {
  try {
    const { leadId, to, subject, body } = await req.json()

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) return NextResponse.json({ error: 'This lead has no valid email address.' }, { status: 400 })
    if (!body?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

    const token = await getGmailToken()
    const from = process.env.GMAIL_FROM!

    const gmailRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: makeRaw(to, from, subject || 'Follow up', body) }),
      }
    )

    if (!gmailRes.ok) {
      return NextResponse.json({ error: gmailError(gmailRes.status, await gmailRes.text()) }, { status: 502 })
    }

    // Log activity
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('activities').insert([{ lead_id: leadId, type: 'email', outcome: 'Sent', body: `Email to ${to} — "${subject}": ${body.slice(0, 200)}` }] as any)

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
