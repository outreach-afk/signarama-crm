import { NextResponse, connection } from 'next/server'

export const maxDuration = 30

// Logged-in users only (middleware). Checks every outbound channel up to the point of sending.
// Never sends a message and never returns a secret.
const mask = (v?: string) => (v ? `${v.slice(0, 4)}…(${v.length})` : 'MISSING')
const digits = (v?: string | null) => (v || '').replace(/\D/g, '').slice(-10)

async function gmail() {
  const out: Record<string, unknown> = {
    env: { GMAIL_CLIENT_ID: mask(process.env.GMAIL_CLIENT_ID), GMAIL_CLIENT_SECRET: mask(process.env.GMAIL_CLIENT_SECRET), GMAIL_REFRESH_TOKEN: mask(process.env.GMAIL_REFRESH_TOKEN), GMAIL_FROM: process.env.GMAIL_FROM || 'MISSING' },
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID || '', client_secret: process.env.GMAIL_CLIENT_SECRET || '', refresh_token: process.env.GMAIL_REFRESH_TOKEN || '', grant_type: 'refresh_token' }),
  })
  const d = await r.json().catch(() => ({}))
  out.tokenStatus = r.status
  if (!r.ok) { out.tokenError = { error: d.error, description: d.error_description }; return out }
  out.scopes = d.scope
  const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${d.access_token}` } })
  out.profileStatus = p.status
  if (p.ok) { const j = await p.json(); out.mailbox = j.emailAddress; out.fromMatchesMailbox = (j.emailAddress || '').toLowerCase() === (process.env.GMAIL_FROM || '').toLowerCase() }
  else out.profileError = (await p.text()).slice(0, 300)
  return out
}

async function ringcentral() {
  const out: Record<string, unknown> = {
    env: { RINGCENTRAL_CLIENT_ID: mask(process.env.RINGCENTRAL_CLIENT_ID), RINGCENTRAL_CLIENT_SECRET: mask(process.env.RINGCENTRAL_CLIENT_SECRET), RINGCENTRAL_JWT_TOKEN: mask(process.env.RINGCENTRAL_JWT_TOKEN), RINGCENTRAL_FROM_NUMBER: process.env.RINGCENTRAL_FROM_NUMBER || 'MISSING' },
  }
  const r = await fetch('https://platform.ringcentral.com/restapi/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${process.env.RINGCENTRAL_CLIENT_ID}:${process.env.RINGCENTRAL_CLIENT_SECRET}`).toString('base64') },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: process.env.RINGCENTRAL_JWT_TOKEN || '' }),
  })
  const d = await r.json().catch(() => ({}))
  out.tokenStatus = r.status
  if (!r.ok) { out.tokenError = { error: d.error, description: d.error_description, errorCode: d.errorCode, message: d.message }; return out }
  out.scopes = d.scope
  const h = { Authorization: `Bearer ${d.access_token}` }
  // No send of any kind here: RingCentral turns letters into keypad digits, so even an 'invalid' recipient can be a real number.

  const ext = await fetch('https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~', { headers: h })
  if (ext.ok) { const e = await ext.json(); out.extension = { name: e.name, number: e.extensionNumber, type: e.type, status: e.status } }
  else out.extensionError = (await ext.text()).slice(0, 300)
  const pn = await fetch('https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/phone-number?perPage=100', { headers: h })
  if (pn.ok) {
    const j = await pn.json()
    const nums = (j.records || []).map((n: { phoneNumber: string; usageType: string; features?: string[]; type?: string }) => ({ number: n.phoneNumber, usage: n.usageType, type: n.type, sms: (n.features || []).includes('SmsSender') }))
    out.numbers = nums
    out.fromNumberOnThisExtension = nums.some((n: { number: string }) => digits(n.number) === digits(process.env.RINGCENTRAL_FROM_NUMBER))
    out.fromNumberCanSendSms = nums.some((n: { number: string; sms: boolean }) => digits(n.number) === digits(process.env.RINGCENTRAL_FROM_NUMBER) && n.sms)
  } else out.numbersError = (await pn.text()).slice(0, 300)
  return out
}

export async function GET() {
  await connection()
  const [g, rc] = await Promise.allSettled([gmail(), ringcentral()])
  return NextResponse.json({
    gmail: g.status === 'fulfilled' ? g.value : { error: String(g.reason) },
    ringcentral: rc.status === 'fulfilled' ? rc.value : { error: String(rc.reason) },
    anthropic: { ANTHROPIC_API_KEY: mask(process.env.ANTHROPIC_API_KEY) },
  })
}
