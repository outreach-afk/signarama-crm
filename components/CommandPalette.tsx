'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { fullName } from '@/lib/leads'
import { ChannelPill, useLeads } from '@/components/LeadBits'

const PAGES = [
  ['Today — follow-ups due', '/today'], ['Calendar', '/calendar'], ['Pipeline board', '/pipeline'], ['Follow-up playbook', '/playbook'],
  ['Revscale leads', '/leads?view=revscale'], ['Inquiries', '/leads?view=revscale&channel=inquiry'], ['Web Pixel visitors', '/leads?view=revscale&channel=web_pixel'],
  ['Apollo leads', '/leads?view=apollo'], ['Reports', '/reports'], ['Dashboard', '/dashboard'], ['Settings', '/settings'], ['Add a lead', '/leads?new=1'],
]

/** Ctrl/⌘+K: jump to any lead or page from anywhere. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  return open ? <Palette close={() => setOpen(false)} /> : <Opener open={() => setOpen(true)} />
}

function Opener({ open }: { open: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open() } }
    window.addEventListener('keydown', key); window.addEventListener('open-command-palette', open)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('open-command-palette', open) }
  }, [open])
  return null
}

function Palette({ close }: { close: () => void }) {
  const router = useRouter()
  const { leads } = useLeads()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])

  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    const pages = PAGES.filter(([n]) => !t || n.toLowerCase().includes(t)).map(([name, href]) => ({ kind: 'page' as const, name, href }))
    if (!t) return pages.slice(0, 8)
    const hits = leads.filter(l => fullName(l).toLowerCase().includes(t) || (l.company || '').toLowerCase().includes(t) || (l.email || '').toLowerCase().includes(t) || (l.phone || '').includes(t))
      .slice(0, 9).map(l => ({ kind: 'lead' as const, lead: l, href: `/leads/${l.id}` }))
    return [...hits, ...pages.slice(0, 4)]
  }, [q, leads])

  const go = (href: string) => { close(); router.push(href) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && results[sel]) go(results[sel].href)
  }

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(4,6,12,0.62)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh' }}>
      <div onClick={e => e.stopPropagation()} onKeyDown={onKey} className="palette">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={17} color="var(--text-secondary)" />
          <input ref={input} value={q} onChange={e => { setQ(e.target.value); setSel(0) }} placeholder="Search a name, company, email or phone…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 15 }} />
          <kbd>Esc</kbd>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {results.length === 0 && <div style={{ padding: 18, fontSize: 13, color: 'var(--text-secondary)' }}>No lead matches “{q}”.</div>}
          {results.map((r, i) => (
            <button key={r.href} onClick={() => go(r.href)} onMouseEnter={() => setSel(i)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text)', background: i === sel ? 'var(--primary-dim)' : 'transparent' }}>
              {r.kind === 'lead' ? (
                <>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{fullName(r.lead)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lead.company || r.lead.email}</span>
                  <ChannelPill lead={r.lead} />
                </>
              ) : (
                <><span style={{ fontSize: 13.5, flex: 1 }}>{r.name}</span><span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Page</span></>
              )}
              {i === sel && <CornerDownLeft size={13} color="var(--text-secondary)" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
