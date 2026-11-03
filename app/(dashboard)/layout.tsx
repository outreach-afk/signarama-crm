import { Suspense } from 'react'
import DashboardNav from '@/components/DashboardNav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Suspense fallback={
        <aside style={{ width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)', position: 'fixed', top: 0, left: 0, bottom: 0 }} />
      }>
        <DashboardNav />
      </Suspense>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: 220, minHeight: '100vh', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
