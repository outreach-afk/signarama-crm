import { Suspense } from 'react'
import DashboardClient from './DashboardClient'

export const instant = false

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading dashboard…</div>}>
      <DashboardClient />
    </Suspense>
  )
}
