'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, ListChecks, CalendarDays, BookOpen, KanbanSquare, BarChart3, Flame, Radar, Inbox, Send, Users, Settings, Search, LogOut,
  type LucideIcon,
} from 'lucide-react'

type Item = { href: string; label: string; icon: LucideIcon; count?: keyof Counts; child?: boolean; section?: string }
type Counts = { web_pixel: number; inquiry: number; apollo: number; warm: number }

const NAV: Item[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/today', label: 'Today', icon: ListChecks, section: 'Follow-up' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/playbook', label: 'Playbook', icon: BookOpen },
  { href: '/leads?view=revscale', label: 'Revscale Leads', icon: Flame, count: 'warm', section: 'Lead sources' },
  { href: '/leads?view=revscale&channel=web_pixel', label: 'Web Pixel', icon: Radar, count: 'web_pixel', child: true },
  { href: '/leads?view=revscale&channel=inquiry', label: 'Inquiry', icon: Inbox, count: 'inquiry', child: true },
  { href: '/leads?view=apollo', label: 'Apollo Leads', icon: Send, count: 'apollo' },
  { href: '/leads', label: 'All Leads', icon: Users },
  { href: '/reports', label: 'Reports', icon: BarChart3, section: 'Workspace' },
  { href: '/settings', label: 'Settings', icon: Settings },
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

  const initials = (user?.full_name || user?.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join('')

  return (
    <aside className="sidebar" style={{
      width: 232, display: 'flex', flexDirection: 'column', flexShrink: 0,
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
    }}>
      <div style={{ padding: '18px 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="logo-mark">S</div>
          <div>
            <div style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.01em' }}>Signarama Corona</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Sales CRM</div>
          </div>
        </div>
        <button className="search-trigger" onClick={() => window.dispatchEvent(new Event('open-command-palette'))}>
          <Search size={14} /> <span style={{ flex: 1, textAlign: 'left' }}>Search leads…</span> <kbd>Ctrl K</kbd>
        </button>
      </div>

      <nav style={{ flex: 1, padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto' }}>
        {NAV.map(({ href, label, icon: Icon, count, child, section }) => {
          const active = isActive(href)
          const n = count ? counts[count] : undefined
          return (
            <div key={href}>
              {section && <div className="nav-section">{section}</div>}
              <Link href={href} className={`nav-item${active ? ' active' : ''}${child ? ' child' : ''}`}>
                <Icon size={child ? 14 : 16} strokeWidth={active ? 2.2 : 1.8} />
                <span style={{ flex: 1 }}>{label}</span>
                {n !== undefined && <span className="nav-count">{n.toLocaleString()}</span>}
              </Link>
            </div>
          )
        })}
      </nav>

      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="avatar">{initials || '?'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || user?.email?.split('@')[0] || '…'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
        </div>
        <button onClick={handleLogout} title="Sign out" className="icon-btn"><LogOut size={15} /></button>
      </div>
    </aside>
  )
}
