import { NextRequest, NextResponse } from 'next/server'
import { adminDb, reconcileApollo, revscaleStatus, syncApollo } from '@/lib/sync'

export const maxDuration = 60

// Called by the Sync buttons (logged-in users only — the middleware guards this route).
export async function POST(req: NextRequest) {
  const { source } = await req.json().catch(() => ({ source: 'apollo' }))
  const db = adminDb()

  try {
    if (source === 'apollo') {
      const r = await syncApollo(db)
      if (!r.ok) return NextResponse.json(r, { status: 500 })
      const apollo = await reconcileApollo(db)
      return NextResponse.json({ ...r, matchedToRevscale: apollo.matched, possibleMatches: apollo.possible })
    }

    if (source === 'revscale') {
      // Revscale only exposes leads through its OAuth connector, which this server cannot call.
      // Leads are pushed in automatically by the scheduled sync; here we refresh the
      // Apollo attribution and report how fresh the data is.
      const apollo = await reconcileApollo(db)
      const status = await revscaleStatus(db)
      return NextResponse.json({
        mode: 'auto',
        imported: status.total,
        ...status,
        matchedToApollo: apollo.matched,
        message: 'Revscale leads sync automatically every hour.',
      })
    }

    return NextResponse.json({ error: `Unknown source "${source}". Use apollo or revscale.` }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: 'Sync failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Freshness for the dashboard header.
export async function GET() {
  try {
    return NextResponse.json(await revscaleStatus(adminDb()))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
