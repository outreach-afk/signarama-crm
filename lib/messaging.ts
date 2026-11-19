// Helpers shared by the email and SMS send routes.

/** RFC 2047: headers must be ASCII. "Follow up — Acme" would otherwise arrive garbled or be rejected. */
export function encodeHeader(v: string) {
  return /^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
}

/**
 * US numbers only. Returns +1XXXXXXXXXX or null. Refuses anything with letters:
 * RingCentral turns letters into keypad digits, so "call-me" would become a real number.
 */
export function toE164(raw: string | null | undefined) {
  const s = (raw || '').trim()
  if (!s || /[a-z]/i.test(s)) return null
  const d = s.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length !== 10 || /^0|^1/.test(ten) || /^(\d)\1{9}$/.test(ten)) return null
  return `+1${ten}`
}

export function gmailError(status: number, body: string) {
  if (/invalid_grant/.test(body)) return 'Gmail is disconnected: the saved Gmail login expired or was revoked. It needs to be reconnected (Settings → Connections).'
  if (/insufficient|scope/i.test(body)) return 'Gmail is connected without permission to send. It needs to be reconnected with the send permission.'
  if (status === 429) return 'Gmail is rate-limiting sends. Wait a minute and try again.'
  return `Gmail refused the message (${status}). ${body.slice(0, 160)}`
}

export function ringcentralError(status: number, body: string) {
  let msg = ''
  try { const j = JSON.parse(body); msg = j.message || j.error_description || j.errors?.[0]?.message || '' } catch { msg = body.slice(0, 160) }
  if (status === 401 || /invalid_grant|token/i.test(msg)) return 'RingCentral is disconnected: the saved login was rejected. It needs to be reconnected.'
  if (/phone number/i.test(msg) && /from/i.test(msg)) return `The sending number is not allowed to send texts on this RingCentral account. ${msg}`
  return `RingCentral refused the text (${status}). ${msg}`
}

/** Send one text from the RingCentral number. Used by the SMS button and the automatic welcome text. */
export async function sendSms(to: string, text: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const phone = toE164(to)
  if (!phone) return { ok: false, error: `"${to}" is not a valid US mobile number` }
  const tok = await fetch('https://platform.ringcentral.com/restapi/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.RINGCENTRAL_CLIENT_ID}:${process.env.RINGCENTRAL_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: process.env.RINGCENTRAL_JWT_TOKEN! }),
  })
  if (!tok.ok) return { ok: false, error: ringcentralError(tok.status, await tok.text()) }
  const { access_token } = await tok.json()
  const r = await fetch('https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: { phoneNumber: process.env.RINGCENTRAL_FROM_NUMBER }, to: [{ phoneNumber: phone }], text }),
  })
  if (!r.ok) return { ok: false, error: ringcentralError(r.status, await r.text()) }
  const sent = await r.json().catch(() => ({}))
  return { ok: true, status: sent.messageStatus || 'Queued' }
}
