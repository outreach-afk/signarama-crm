import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendSms, toE164 } from '@/lib/messaging'

export async function POST(req: NextRequest) {
  try {
    const { leadId, to, body } = await req.json()
    const phone = toE164(to)
    if (!phone) return NextResponse.json({ error: to ? `"${to}" is not a valid US mobile number, so no text was sent.` : 'This lead has no phone number.' }, { status: 400 })
    if (!body?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
    const r = await sendSms(phone, body)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('activities').insert([{ lead_id: leadId, type: 'sms', body: `SMS to ${phone}: ${body}`, outcome: 'Sent' }] as any)
    return NextResponse.json({ ok: true, status: r.status })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
