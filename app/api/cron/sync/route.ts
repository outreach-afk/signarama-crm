import { NextResponse } from 'next/server'

// Called by Vercel Cron every 15 minutes
// Cron secret protects this endpoint from public access
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://signarama-crm.vercel.app'
  const results: Record<string, unknown> = {}

  // Sync Revscale
  try {
    const r = await fetch(`${base}/api/leads/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'revscale' }),
    })
    results.revscale = await r.json()
  } catch (e) {
    results.revscale = { error: String(e) }
  }

  // Sync Apollo
  try {
    const r = await fetch(`${base}/api/leads/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'apollo' }),
    })
    results.apollo = await r.json()
  } catch (e) {
    results.apollo = { error: String(e) }
  }

  return NextResponse.json({ ok: true, results, at: new Date().toISOString() })
}
