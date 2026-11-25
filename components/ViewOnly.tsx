'use client'

import { useEffect } from 'react'
import { Eye } from 'lucide-react'
import { useTeam } from '@/components/LeadBits'

/** Marks the page as view-only (hides every .edit-only control) and shows a banner. */
export default function ViewOnlyBanner() {
  const { viewOnly } = useTeam()
  useEffect(() => {
    if (viewOnly) document.body.dataset.viewonly = '1'
    else delete document.body.dataset.viewonly
  }, [viewOnly])
  if (!viewOnly) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 32px', background: 'rgba(59,130,246,0.10)', borderBottom: '1px solid rgba(59,130,246,0.3)', color: '#93C5FD', fontSize: 13 }}>
      <Eye size={15} /> <b style={{ fontWeight: 600 }}>View only.</b> You can look at everything in the CRM, but you can&apos;t change, send or delete anything.
    </div>
  )
}
