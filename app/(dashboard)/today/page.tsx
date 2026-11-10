import { Suspense } from 'react'
import TodayClient from './TodayClient'

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading…</div>}><TodayClient /></Suspense>
}
