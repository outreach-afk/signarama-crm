import { Suspense } from 'react'
import SettingsClient from './SettingsClient'

export const instant = false

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-secondary)' }}>Loading settings…</div>}>
      <SettingsClient />
    </Suspense>
  )
}
