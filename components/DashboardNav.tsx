'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '⚡' },
  { href: '/leads', label: 'Leads', icon: '👥' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function DashboardNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<{ email?: string; full_name?: string } | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUser({ email: data.user.email, full_name: data.user.user_metadata?.full_name })
    })
  }, [router])

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
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 8, textDecoration: 'none',
              background: active ? 'var(--primary-dim)' : 'transparent',
              color: active ? 'var(--primary)' : 'var(--text-secondary)',
              fontSize: 14, fontWeight: active ? 600 : 400,
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 16 }}>{icon}</span>
              {label}
            </Link>
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
