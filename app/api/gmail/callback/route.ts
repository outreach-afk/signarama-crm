import { NextRequest, NextResponse } from 'next/server'
import { CRM_REDIRECT, exchangeCode, saveRefreshToken } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const back = (msg: string) => NextResponse.redirect(new URL(`/settings?gmail=${encodeURIComponent(msg)}`, req.url))
  if (q.get('error')) return back(`error:${q.get('error')}`)
  if (!q.get('code') || q.get('state') !== req.cookies.get('gmail_oauth_state')?.value) return back('error:state_mismatch')
  try {
    const { refreshToken, email } = await exchangeCode(q.get('code')!, CRM_REDIRECT)
    await saveRefreshToken(refreshToken, email)
    return back(`connected:${email || ''}`)
  } catch (e) { return back(`error:${e instanceof Error ? e.message : 'failed'}`) }
}
