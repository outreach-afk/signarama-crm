import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { type, lead } = await req.json()

    if (!type || !lead) {
      return NextResponse.json({ error: 'Missing type or lead' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic API not configured' }, { status: 500 })
    }

    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'there'
    const company = lead.company ? ` at ${lead.company}` : ''
    const stage = lead.stage || 'new'
    const dealValue = lead.deal_value ? ` (deal value ~$${lead.deal_value.toLocaleString()})` : ''
    const nextStep = lead.next_step ? ` Their next step: ${lead.next_step}.` : ''

    const systemPrompt = `You are a friendly, professional sales rep at Signarama Corona, a sign shop in Corona, CA.
Signarama makes custom signs, banners, vehicle wraps, trade show displays, wayfinding signage, and branded graphics for businesses.
Write outreach that is warm, direct, and focused on helping the prospect — never pushy or generic.`

    const userPrompt = type === 'sms'
      ? `Write a short SMS (under 160 characters) to ${name}${company} who is in the "${stage}" stage of our pipeline${dealValue}.${nextStep}
The SMS should feel personal and prompt a quick reply. Do NOT include a subject line. Output ONLY the message text.`
      : `Write a short follow-up email body (3-4 sentences) to ${name}${company} who is in the "${stage}" stage of our pipeline${dealValue}.${nextStep}
The email should be warm, reference their business needs for signage, and include a clear call to action.
Do NOT include a subject line or greeting — just the body paragraphs. Output ONLY the email body.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic API error:', response.status, err)
      return NextResponse.json({ error: 'AI service error', detail: err, status: response.status }, { status: 500 })
    }

    const data = await response.json()
    const draft = data.content?.[0]?.text?.trim() || ''

    return NextResponse.json({ draft })
  } catch (err) {
    console.error('AI draft error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
