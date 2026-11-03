import { Suspense } from 'react'
import LeadDetailClient from './LeadDetailClient'

export const instant = false

export default function LeadDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading…</div>}>
      <LeadDetailClient />
    </Suspense>
  )
}
