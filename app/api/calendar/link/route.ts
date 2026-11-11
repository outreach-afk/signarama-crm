import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { calendarToken } from '@/lib/sync'

// Logged-in users only (guarded by the middleware). Returns the private calendar-feed address.
export async function GET() {
  return NextResponse.json({ url: `https://signarama-crm.vercel.app/api/calendar/feed?key=${calendarToken()}` })
}
