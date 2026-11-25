import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/sync'

// Change someone's access. Only editors get here (middleware refuses viewers); roles are written
// with the service role because the database blocks role changes from the app itself.
const ROLES = ['owner', 'manager', 'bdr', 'viewer']

export async function POST(req: NextRequest) {
  const { id, role } = await req.json().catch(() => ({}))
  if (!id || !ROLES.includes(role)) return NextResponse.json({ error: 'Missing person or role' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (user.id === id && role === 'viewer') return NextResponse.json({ error: 'You cannot make yourself view-only.' }, { status: 400 })
  const db = adminDb()
  const { error } = await db.from('profiles').update({ role }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
