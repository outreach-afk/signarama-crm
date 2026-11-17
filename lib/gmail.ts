// Gmail connection for the CRM. The refresh token lives in private_settings (server-only),
// falling back to the GMAIL_REFRESH_TOKEN env var.
import { adminDb } from '@/lib/sync'

export const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send']
export const CRM_REDIRECT = 'https://signarama-crm.vercel.app/api/gmail/callback'
export const PLAYGROUND_REDIRECT = 'https://developers.google.com/oauthplayground'
const KEY = 'gmail_refresh_token'

export async function getRefreshToken() {
  const { data } = await adminDb().from('private_settings').select('value').eq('key', KEY).maybeSingle()
  return { token: (data?.value as string | undefined) || process.env.GMAIL_REFRESH_TOKEN || '', source: data?.value ? 'crm' : 'env' }
}

export async function saveRefreshToken(token: string, email: string | null) {
  const db = adminDb()
  const now = new Date().toISOString()
  const r = await db.from('private_settings').upsert([{ key: KEY, value: token, updated_at: now }, { key: 'gmail_account', value: email || 'unknown', updated_at: now }])
  if (r.error) throw new Error(r.error.message)
}

export function authUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID || '', redirect_uri: redirectUri, response_type: 'code',
    scope: GMAIL_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    login_hint: process.env.GMAIL_FROM || '', state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

/** Exchange an authorization code; returns the refresh token and the Google account email. */
export async function exchangeCode(code: string, redirectUri: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GMAIL_CLIENT_ID || '', client_secret: process.env.GMAIL_CLIENT_SECRET || '', redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${d.error || r.status}: ${d.error_description || 'token exchange failed'}`)
  if (!d.refresh_token) throw new Error('Google did not return a refresh token. Remove the CRM from the Google account’s third-party access and connect again.')
  let email: string | null = null
  try { email = JSON.parse(Buffer.from(String(d.id_token).split('.')[1], 'base64url').toString()).email || null } catch { /* no id token */ }
  if (!String(d.scope || '').includes('gmail.send')) throw new Error('The send permission was not granted. Connect again and tick the Gmail permission.')
  return { refreshToken: d.refresh_token as string, email }
}

export async function accessToken() {
  const { token } = await getRefreshToken()
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID || '', client_secret: process.env.GMAIL_CLIENT_SECRET || '', refresh_token: token, grant_type: 'refresh_token' }),
  })
  const text = await r.text()
  return { ok: r.ok, status: r.status, text, token: r.ok ? (JSON.parse(text).access_token as string) : null }
}
