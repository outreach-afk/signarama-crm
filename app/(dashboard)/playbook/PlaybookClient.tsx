'use client'

import Link from 'next/link'
import { Phone, Mail, MessageSquare } from 'lucide-react'
import { CADENCES, NURTURE_DAYS, type TouchType } from '@/lib/cadence'
import { card, h1, sub } from '@/components/LeadBits'

const ICON: Record<TouchType, React.ReactNode> = {
  call: <Phone size={13} />, email: <Mail size={13} />, sms: <MessageSquare size={13} />,
}
const COLOR: Record<TouchType, string> = { call: '#10B981', email: '#3B82F6', sms: '#8B5CF6' }

const RULES: [string, string][] = [
  ['Answer inquiries within the hour — within 5 minutes when you can.', 'Speed is the single biggest factor in whether you ever reach the person. The chance of a conversation drops sharply after the first few minutes and again after the first hour. A sign buyer usually asks two or three shops; the first one to call sets the terms.'],
  ['Call first, then write.', 'A call gets the details you need to quote (size, material, install, deadline) in two minutes. Email is the follow-up to the call, not a replacement for it.'],
  ['Mix the channels: call, email, text.', 'People answer different channels. A cadence that uses all three reaches more people than six emails. Text only numbers the customer gave you, keep it short, and stop if they ask.'],
  ['Do not stop at two attempts.', 'Most shops call once, email once and give up. Most conversations happen on the third to sixth attempt. The cadences below run 5 to 8 touches over two to three weeks.'],
  ['Change the time of day.', 'If the morning call did not connect, try late afternoon. Mid-week, 4–5 pm and 8–10 am, tends to be best for reaching business owners.'],
  ['Every touch gives something.', 'A price range, a photo of a similar job, a lead time, one clear question. "Just checking in" gets ignored.'],
  ['Log every touch the moment you make it.', 'That is what moves the lead to its next step and shows everyone when the last call, email and text happened. A touch that is not logged did not happen as far as the team can tell.'],
  ['End with a close-the-file email.', 'Saying you will close the request gets more replies than any other message, and it keeps the list honest.'],
  ['Follow up every quote.', 'A quote without a follow-up is the most expensive lead to lose: the work is already done. Call the next day to confirm they received it.'],
]

export default function PlaybookClient() {
  return (
    <div style={{ padding: 32, maxWidth: 980 }}>
      <h1 style={h1}>Follow-up playbook</h1>
      <p style={{ ...sub, marginBottom: 24 }}>
        The standard way Signarama Corona follows up a lead. The <Link href="/today" style={{ color: 'var(--primary)' }}>Today</Link> list and the calendar are built from these steps,
        so working that list top to bottom is following this playbook.
      </p>

      <div style={{ ...card, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>The rules</div>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {RULES.map(([t, d]) => (
            <li key={t} style={{ fontSize: 14, lineHeight: 1.55 }}>
              <b style={{ fontWeight: 600 }}>{t}</b>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>{d}</div>
            </li>
          ))}
        </ol>
      </div>

      {Object.values(CADENCES).map(c => {
        let day = 0
        return (
          <div key={c.key} style={{ ...card, marginBottom: 20, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 3 }}>{c.goal}</div>
            </div>
            {c.steps.map((s, i) => {
              day += s.gap
              return (
                <div key={i} style={{ display: 'flex', gap: 16, padding: '13px 24px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                  <div style={{ width: 54, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', paddingTop: 2 }}>Day {day}</div>
                  <div style={{ display: 'flex', gap: 5, width: 62, flexShrink: 0, paddingTop: 1 }}>
                    {s.do.map(t => (
                      <span key={t} title={t} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, background: `${COLOR[t]}1c`, color: COLOR[t] }}>{ICON[t]}</span>
                    ))}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{i + 1}. {s.title}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55, marginTop: 2 }}>{s.script}</div>
                  </div>
                </div>
              )
            })}
            <div style={{ padding: '11px 24px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              After the last step: one check-in every {NURTURE_DAYS} days until they buy or say no. Days are counted from the previous touch, so a late step pushes the rest back.
            </div>
          </div>
        )
      })}
    </div>
  )
}
