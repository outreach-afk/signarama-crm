import { Suspense } from 'react'
import DashboardNav from '@/components/DashboardNav'
import CommandPalette from '@/components/CommandPalette'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Suspense fallback={
        <aside style={{ width: 232, background: 'var(--surface)', borderRight: '1px solid var(--border)', position: 'fixed', top: 0, left: 0, bottom: 0 }} />
      }>
        <DashboardNav />
      </Suspense>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: 232, minHeight: '100vh', overflow: 'auto' }}>
        {children}
      </main>
      <CommandPalette />
    </div>
  )
}
