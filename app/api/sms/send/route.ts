import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function getRingCentralToken() {
  const res = await fetch('https://platform.ringcentral.com/restapi/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(
        `${process.env.RINGCENTRAL_CLIENT_ID}:${process.env.RINGCENTRAL_CLIENT_SECRET}`
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: process.env.RINGCENTRAL_JWT_TOKEN!,
    }),
  })
  if (!res.ok) throw new Error('RingCentral auth failed')
  const data = await res.json()
  return data.access_token as string
}

export async function POST(req: NextRequest) {
  try {
    const { leadId, to, body } = await req.json()

    if (!to) return NextResponse.json({ error: 'No phone number' }, { status: 400 })
    if (!body?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })

    const token = await getRingCentralToken()

    const smsRes = await fetch(
      'https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { phoneNumber: process.env.RINGCENTRAL_FROM_NUMBER },
          to: [{ phoneNumber: to }],
          text: body,
        }),
      }
    )

    if (!smsRes.ok) {
      const err = await smsRes.text()
      return NextResponse.json({ error: err }, { status: 500 })
    }

    // Log activity
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('activities').insert([{ lead_id: leadId, type: 'sms', body: `SMS to ${to}: ${body}` }] as any)

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
