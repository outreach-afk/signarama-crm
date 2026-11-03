import { NextResponse } from 'next/server'

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
  if (!res.ok) throw new Error('RC auth failed: ' + await res.text())
  const data = await res.json()
  return data.access_token as string
}

export async function GET() {
  try {
    const token = await getRingCentralToken()
    const extRes = await fetch('https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const extData = await extRes.json()
    const numsRes = await fetch('https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/phone-number', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const numsData = await numsRes.json()
    return NextResponse.json({ extension: extData, phoneNumbers: numsData })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
