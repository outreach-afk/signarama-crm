import { NextRequest, NextResponse } from 'next/server'
import { PLAYGROUND_REDIRECT, exchangeCode, saveRefreshToken } from '@/lib/gmail'

// Logged-in users only (middleware). Finishes a connection that returned to the OAuth Playground address.
export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({}))
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  try {
    const { refreshToken, email } = await exchangeCode(String(code), PLAYGROUND_REDIRECT)
    await saveRefreshToken(refreshToken, email)
    return NextResponse.json({ ok: true, email })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 400 }) }
}
