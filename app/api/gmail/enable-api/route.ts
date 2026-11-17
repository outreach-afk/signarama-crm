import { NextRequest, NextResponse } from 'next/server'
import { PLAYGROUND_REDIRECT, projectNumber } from '@/lib/gmail'

export const maxDuration = 30

// Logged-in users only (middleware). One-time: switches on the Gmail API in the Google Cloud project
// behind the CRM's OAuth client. The short-lived token is used for this single call and never stored.
export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({}))
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  const t = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(code), client_id: process.env.GMAIL_CLIENT_ID || '', client_secret: process.env.GMAIL_CLIENT_SECRET || '', redirect_uri: PLAYGROUND_REDIRECT, grant_type: 'authorization_code' }),
  })
  const tok = await t.json().catch(() => ({}))
  if (!t.ok) return NextResponse.json({ error: `token: ${tok.error || t.status} ${tok.error_description || ''}` }, { status: 400 })
  const project = projectNumber()
  const r = await fetch(`https://serviceusage.googleapis.com/v1/projects/${project}/services/gmail.googleapis.com:enable`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: '{}',
  })
  const body = await r.text()
  return NextResponse.json({ ok: r.ok, status: r.status, project, result: body.slice(0, 600) }, { status: r.ok ? 200 : 400 })
}
