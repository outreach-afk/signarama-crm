import { Suspense } from 'react'
import PlaybookClient from './PlaybookClient'

export default function PlaybookPage() {
  return (
    <Suspense fallback={null}>
      <PlaybookClient />
    </Suspense>
  )
}
