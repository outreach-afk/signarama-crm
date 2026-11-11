import { NextResponse, connection } from 'next/server'
import { calendarToken } from '@/lib/sync'

// Logged-in users only (guarded by the middleware). Returns the private calendar-feed address.
export async function GET() {
  await connection() // read the secret at request time, never at build time
  return NextResponse.json({ url: `https://signarama-crm.vercel.app/api/calendar/feed?key=${calendarToken()}` })
}
