import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.REVSCALE_API_KEY
  const workspaceId = process.env.REVSCALE_WORKSPACE_ID || '68c859b73e538f39fb4ac009'

  if (!apiKey) return NextResponse.json({ error: 'no key' })

  const baseUrls = [
    `https://api.revscale.com/v1/companies/${workspaceId}/leads?source=lead_finder&per_page=5`,
    `https://api.revscale.com/api/v1/companies/${workspaceId}/leads?source=lead_finder&per_page=5`,
    `https://api.revscale.ai/v1/companies/${workspaceId}/leads?source=lead_finder&per_page=5`,
    `https://revscale.com/api/v1/companies/${workspaceId}/leads?source=lead_finder&per_page=5`,
    `https://app.revscale.com/api/v1/companies/${workspaceId}/leads?source=lead_finder&per_page=5`,
  ]

  const results: any[] = []
  for (const url of baseUrls) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
      const body = await r.text()
      results.push({ url, status: r.status, body: body.substring(0, 300) })
    } catch (e: any) {
      results.push({ url, error: e?.message })
    }
  }

  return NextResponse.json({ workspaceId, keyPrefix: apiKey.substring(0, 10) + '...', results })
}
