import { Suspense } from 'react'
import ReportsClient from './ReportsClient'

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading…</div>}><ReportsClient /></Suspense>
}
