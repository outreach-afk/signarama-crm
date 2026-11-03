import { Suspense } from 'react'
import LoginClient from './LoginClient'

export const instant = false

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  )
}
