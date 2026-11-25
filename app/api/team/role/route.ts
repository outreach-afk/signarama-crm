import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/sync'

// Change someone's access. Owner only; roles are written
// with the service role because the database blocks role changes from the app itself.
const ROLES = ['bdr', 'viewer', 'denied'] // can edit · view only · blocked

export async function POST(req: NextRequest) {
  const { id, role } = await req.json().catch(() => ({}))
  if (!id || !ROLES.includes(role)) return NextResponse.json({ error: 'Missing person or role' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const db = adminDb()
  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'owner') return NextResponse.json({ error: 'Only the owner (Orlando) can change who has access.' }, { status: 403 })
  if (user.id === id) return NextResponse.json({ error: 'You cannot change your own access.' }, { status: 400 })
  const { error } = await db.from('profiles').update({ role }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
