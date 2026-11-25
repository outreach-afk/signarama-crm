import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/sync'

// Owner only: why each waiting person asked for access (from the sign-up form).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const db = adminDb()
  const { data: me } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'owner') return NextResponse.json({ reasons: {} })
  const { data: waiting } = await db.from('profiles').select('id').eq('role', 'pending')
  const reasons: Record<string, { reason: string; at: string | null }> = {}
  for (const p of waiting || []) {
    const { data: u } = await db.auth.admin.getUserById(p.id)
    reasons[p.id] = { reason: String(u.user?.user_metadata?.access_reason || ''), at: u.user?.created_at || null }
  }
  return NextResponse.json({ reasons })
}
