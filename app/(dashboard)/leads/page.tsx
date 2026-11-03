import { Suspense } from 'react'
import LeadsClient from './LeadsClient'

export const instant = false

export default function LeadsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading leads…</div>}>
      <LeadsClient />
    </Suspense>
  )
}
