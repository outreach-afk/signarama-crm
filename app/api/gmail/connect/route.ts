import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { CRM_REDIRECT, PLAYGROUND_REDIRECT, authUrl } from '@/lib/gmail'

// Logged-in users only (middleware). Starts Google's approval screen for sending email as outreach@.
// ?via=playground uses the OAuth Playground address as the return address, for when the CRM address is not registered.
export async function GET(req: NextRequest) {
  const via = req.nextUrl.searchParams.get('via') === 'playground' ? 'playground' : 'crm'
  const state = randomBytes(16).toString('hex')
  const purpose = req.nextUrl.searchParams.get('purpose') === 'enable' ? 'enable' : 'gmail'
  const res = NextResponse.redirect(authUrl(via === 'crm' ? CRM_REDIRECT : PLAYGROUND_REDIRECT, state, purpose))
  res.cookies.set('gmail_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
