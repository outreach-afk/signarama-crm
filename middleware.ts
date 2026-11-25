import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Machine endpoints carry their own secret (x-ingest-secret / CRON_SECRET) and have no session.
  const path = request.nextUrl.pathname
  if (path === '/api/leads/ingest' || path === '/api/calendar/feed' || path.startsWith('/api/cron/')) return supabaseResponse

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthPage = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/register')

  if (!user && !isAuthPage) {
    // API callers get a JSON 401 instead of an HTML redirect to the login page.
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Approval gate. pending / denied accounts see only the waiting page; viewers cannot change anything.
  if (user && !isAuthPage) {
    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    const role = me?.role || 'pending'
    const waiting = role === 'pending' || role === 'denied'
    if (waiting) {
      if (path === '/api/access/request') return supabaseResponse
      if (path.startsWith('/api/')) return NextResponse.json({ error: 'Your account is waiting for approval.' }, { status: 403 })
      if (path !== '/pending') { const url = request.nextUrl.clone(); url.pathname = '/pending'; url.search = ''; return NextResponse.redirect(url) }
      return supabaseResponse
    }
    if (path === '/pending') { const url = request.nextUrl.clone(); url.pathname = '/today'; return NextResponse.redirect(url) }
    if (role === 'viewer' && path.startsWith('/api/') && request.method !== 'GET' && !path.startsWith('/api/auth')) {
      return NextResponse.json({ error: 'You have view-only access to this CRM.' }, { status: 403 })
    }
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
