import { NextResponse } from 'next/server'
import { adminDb, reconcileApollo, syncApollo } from '@/lib/sync'

export const maxDuration = 60

// Vercel Cron (daily on the Hobby plan). Pulls Apollo and refreshes the Apollo → Revscale match.
// Revscale itself is pushed into /api/leads/ingest by the scheduled Claude task.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = adminDb()
  const results: Record<string, unknown> = {}
  try { results.apollo = await syncApollo(db, { budgetMs: 25_000 }) } catch (e) { results.apollo = { error: String(e) } }
  try { results.attribution = await reconcileApollo(db) } catch (e) { results.attribution = { error: String(e) } }

  return NextResponse.json({ ok: true, results, at: new Date().toISOString() })
}
