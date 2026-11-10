import { Suspense } from 'react'
import PipelineClient from './PipelineClient'

export default function Page() {
  return <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading…</div>}><PipelineClient /></Suspense>
}
