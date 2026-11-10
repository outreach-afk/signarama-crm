'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Item = { href: string; label: string; icon: string; count?: keyof Counts; child?: boolean; section?: string }
type Counts = { web_pixel: number; inquiry: number; apollo: number; warm: number }

const NAV: Item[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '⚡' },
  { href: '/leads?view=revscale', label: 'Revscale Leads', icon: '🔥', count: 'warm', section: 'Lead sources' },
  { href: '/leads?view=revscale&channel=web_pixel', label: 'Web Pixel', icon: '📡', count: 'web_pixel', child: true },
  { href: '/leads?view=revscale&channel=inquiry', label: 'Inquiry', icon: '📨', count: 'inquiry', child: true },
  { href: '/leads?view=apollo', label: 'Apollo Leads', icon: '🚀', count: 'apollo' },
  { href: '/leads', label: 'All Leads', icon: '👥' },
  { href: '/settings', label: 'Settings', icon: '⚙️', section: 'Workspace' },
]

export default function DashboardNav() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [counts, setCounts] = useState<Partial<Counts>>({})
  const [user, setUser] = useState<{ email?: string; full_name?: string } | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUser({ email: data.user.email, full_name: data.user.user_metadata?.full_name })
    })
  }, [router])

  useEffect(() => {
    const supabase = createClient()
    const n = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0)
    const head = () => supabase.from('leads').select('id', { count: 'exact', head: true })
    const load = () => Promise.all([
      n(head().eq('source', 'revscale').eq('source_subtype', 'web_pixel')),
      n(head().eq('source', 'revscale').eq('source_subtype', 'inquiry')),
      n(head().eq('source', 'apollo')),
    ]).then(([web_pixel, inquiry, apollo]) => setCounts({ web_pixel, inquiry, apollo, warm: web_pixel + inquiry })).catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  function isActive(href: string) {
    const [path, query = ''] = href.split('?')
    if (path !== '/leads') return pathname === path || pathname.startsWith(path + '/')
    if (pathname !== '/leads') return href === '/leads' && pathname.startsWith('/leads/')
    const want = new URLSearchParams(query)
    return (searchParams.get('view') || '') === (want.get('view') || '') &&
      (searchParams.get('channel') || '') === (want.get('channel') || '')
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside style={{
      width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', padding: '20px 0', flexShrink: 0,
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🏷️</div>
          <div>
            <div style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontWeight: 700, fontSize: 14 }}>Signarama</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Corona CRM</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ href, label, icon, count, child, section }) => {
          const active = isActive(href)
          const n = count ? counts[count] : undefined
          return (
            <div key={href}>
              {section && (
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', opacity: 0.7, padding: '14px 12px 6px' }}>{section}</div>
              )}
              <Link href={href} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: child ? '7px 12px 7px 30px' : '9px 12px', borderRadius: 8, textDecoration: 'none',
                background: active ? 'var(--primary-dim)' : 'transparent',
                color: active ? 'var(--primary)' : 'var(--text-secondary)',
                fontSize: child ? 13 : 14, fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: child ? 13 : 16 }}>{icon}</span>
                <span style={{ flex: 1 }}>{label}</span>
                {n !== undefined && (
                  <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: active ? 1 : 0.75 }}>{n.toLocaleString()}</span>
                )}
              </Link>
            </div>
          )
        })}
      </nav>

      {/* User */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
          {user?.full_name || user?.email?.split('@')[0] || '…'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>{user?.email}</div>
        <button onClick={handleLogout} style={{
          width: '100%', padding: '7px', background: 'transparent',
          border: '1px solid var(--border)', borderRadius: 7,
          color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
        }}>
          Sign out
        </button>
      </div>
    </aside>
  )
}
