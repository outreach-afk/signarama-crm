// Free, step-by-step message templates. Each follow-up step has its own email and text, so the
// lead never gets the same message twice. Used when AI drafting is off (no API credit) and as a
// fallback when the AI fails. Edit the wording here.
//
// Placeholders: {first} first name · {need} what they asked for ("your stickers request")
// {ask} the one or two things we still need to quote · {company} · {industry}

export type Msg = { subject: string; email: string; sms: string }

const SIGN = '\n\nThanks,' // the email signature (Settings → Email signature) is added on send

// Inquiry: they asked for a quote. 8 steps (lib/cadence.ts CADENCES.inquiry).
const INQUIRY: Msg[] = [
  { // 1. Call now, then email
    subject: 'Your {needShort} request',
    email: 'Hi {first},\n\nThanks for contacting Signarama Corona about {need}. I just tried to call you so we can get you an accurate price quickly.\n\nTo get started, could you tell me {ask}?' + SIGN,
    sms: 'Hi {first}, this is Signarama Corona about {need}. I just tried calling. To price it, could you tell me {ask}? Or reply with a good time to call.',
  },
  { // 2. Text if no answer
    subject: 'Quick question about {need}',
    email: 'Hi {first},\n\nI tried to reach you by phone about {need}. What is the best time to call today or tomorrow? It usually takes about five minutes to get everything we need for a price.' + SIGN,
    sms: 'Hi {first}, Signarama Corona again. I tried calling about {need}. When is a good time for a 5-minute call today or tomorrow?',
  },
  { // 3. Second call, different time of day
    subject: 'Still happy to help with {need}',
    email: 'Hi {first},\n\nI tried you again today about {need}. If a call is hard to fit in, no problem: just reply here with {ask} and I will take it from there.' + SIGN,
    sms: 'Hi {first}, tried you again about {need}. If calls are tricky, just text me {ask} and I will work on the price.',
  },
  { // 4. Email with one useful thing
    subject: 'A few options for {need}',
    email: 'Hi {first},\n\nWhile I wait to hear back, here is something useful: most {needShort} jobs we do come down to three things, size, material and whether we install it. If you send {ask}, I can give you a ballpark range the same day, with no commitment.\n\nIf you have a photo of where it is going, that helps too.' + SIGN,
    sms: 'Hi {first}, happy to send a no-commitment ballpark for {need}. Just reply with {ask}. A photo of the spot helps too.',
  },
  { // 5. Call + text
    subject: 'Ballpark for {need}?',
    email: 'Hi {first},\n\nI called again today about {need}. Would a rough price range help you plan, even before we have every detail? I can send one based on what you have told us so far.' + SIGN,
    sms: 'Hi {first}, still happy to help with {need}. Want me to send a ballpark so you have it? Just reply yes.',
  },
  { // 6. Proof email
    subject: 'A recent job like yours',
    email: 'Hi {first},\n\nWe recently finished a {needShort} project for a local business here in the Inland Empire, and it made me think of your request. If you would like to see photos of similar work, or talk through ideas, I am happy to.\n\nIs the project still on your list?' + SIGN,
    sms: 'Hi {first}, we just finished a {needShort} job for a local business. Want me to send a couple of photos of similar work?',
  },
  { // 7. Last call
    subject: 'Checking in on {need}',
    email: 'Hi {first},\n\nI tried calling once more about {need}. I do not want to keep chasing you, so I will send one last note in a few days. If the timing is not right, just let me know.' + SIGN,
    sms: 'Hi {first}, last try from Signarama Corona about {need}. Is it still happening, or should I check back later?',
  },
  { // 8. Close-the-file email
    subject: 'Should I close your request?',
    email: 'Hi {first},\n\nI have not been able to reach you, so I will close your request for {need} for now. If the project is still going ahead, just reply to this email and I will pick it straight back up.\n\nThanks for thinking of Signarama Corona.' + SIGN,
    sms: 'Hi {first}, I will close your {needShort} request for now. If it is still on, just reply and I will pick it right back up. Thanks!',
  },
]

// Web Pixel: they did NOT contact us. Never mention the website visit. 5 steps.
const WEB_PIXEL: Msg[] = [
  { // 1. Intro email
    subject: 'Signs for {company}',
    email: 'Hi {first},\n\nThank you for your interest in Signarama Corona. We are the local sign shop here in Corona, and we help businesses{companyLike} with building signs, window graphics, vehicle wraps and banners.\n\nIs there a project coming up that we could help you with?' + SIGN,
    sms: 'Hi {first}, this is Signarama Corona, the local sign shop in Corona. Thanks for your interest! Is there a sign or graphics project we could help you with? Reply STOP to opt out.',
  },
  { // 2. Call if there is a number
    subject: 'Quick follow-up from Signarama Corona',
    email: 'Hi {first},\n\nFollowing up on my last note. I tried to give you a call as well. If you have anything coming up, a new sign, a grand opening, vehicle graphics, or just something that needs refreshing, I am happy to give you a quick price.' + SIGN,
    sms: 'Hi {first}, Signarama Corona here following up. Anything coming up we could price for you, like a sign, banner or vehicle graphics?',
  },
  { // 3. Example email
    subject: 'An idea for {company}',
    email: 'Hi {first},\n\nA lot of {industryPlural} we work with start with something simple: window graphics or a banner to get noticed, then a permanent sign once they know what works. If you would like, I can send a couple of examples and price ranges so you have them on hand.\n\nWould that be useful?' + SIGN,
    sms: 'Hi {first}, want me to send a couple of examples and price ranges for signs and graphics, so you have them on hand? No commitment.',
  },
  { // 4. Text or call
    subject: 'Still here if you need us',
    email: 'Hi {first},\n\nJust checking in. If a sign or graphics project is on your list for the next few months, I would be glad to help you plan it and budget for it.' + SIGN,
    sms: 'Hi {first}, just checking in from Signarama Corona. Any sign or graphics project on your list in the next few months?',
  },
  { // 5. Last email
    subject: 'Keep us in mind',
    email: 'Hi {first},\n\nNo project right now? No problem at all. Keep my number for when one comes up, and I will check in again in a month or so.\n\nThanks for your interest in Signarama Corona.' + SIGN,
    sms: 'Hi {first}, no project right now? No problem. Save this number for when one comes up. Thanks from Signarama Corona!',
  },
]

// Quote sent. 5 steps.
const QUOTED: Msg[] = [
  { subject: 'Your quote from Signarama Corona',
    email: 'Hi {first},\n\nJust making sure the quote for {need} came through and covers everything you need. Is there anything you would like changed or explained?' + SIGN,
    sms: 'Hi {first}, did the quote for {need} come through OK? Anything you want changed?' },
  { subject: 'Options for your {needShort} quote',
    email: 'Hi {first},\n\nI wanted to follow up on your quote. If price, timing or the design is holding things up, I am happy to put together an alternative option, for example a different material or size.' + SIGN,
    sms: 'Hi {first}, if anything in the quote is holding you back (price, timing, design), I can put together another option. Just say the word.' },
  { subject: 'When do you need it installed?',
    email: 'Hi {first},\n\nWhen are you hoping to have the {needShort} in place? If I know your date, I can work backwards and make sure production is booked in time.' + SIGN,
    sms: 'Hi {first}, when are you hoping to have the {needShort} up? I can work backwards from your date to book production.' },
  { subject: 'Production schedule',
    email: 'Hi {first},\n\nA quick heads-up: our production calendar is filling up. If you would like the {needShort} finished on time, approving the quote this week keeps you on schedule.' + SIGN,
    sms: 'Hi {first}, our production schedule is filling up. Approving this week keeps your {needShort} on time. Any questions I can answer?' },
  { subject: 'Is the project still going ahead?',
    email: 'Hi {first},\n\nI wanted to check whether the {needShort} project is still going ahead. If plans changed, just let me know, it helps us a lot to know what happened.' + SIGN,
    sms: 'Hi {first}, is the {needShort} project still going ahead? If plans changed, just let me know.' },
]

// Working lead (contacted, not yet quoted). 4 steps.
const DEFAULT: Msg[] = [
  { subject: 'Next step for {need}',
    email: 'Hi {first},\n\nGood to be in touch. To get you a price for {need}, the only things I still need are {ask}.' + SIGN,
    sms: 'Hi {first}, to get you a price for {need} I just need {ask}.' },
  { subject: 'Where we are with {need}',
    email: 'Hi {first},\n\nA quick recap: we are ready to price {need} as soon as we have {ask}. Reply whenever suits you.' + SIGN,
    sms: 'Hi {first}, we can price {need} as soon as we have {ask}. Reply whenever suits.' },
  { subject: 'Following up on {need}',
    email: 'Hi {first},\n\nI tried you again today. Is {need} still something you are planning? Happy to work around your timing.' + SIGN,
    sms: 'Hi {first}, is {need} still on your list? Happy to work around your timing.' },
  { subject: 'Should I close this for now?',
    email: 'Hi {first},\n\nI will close {need} for now so I stop chasing you. If it comes back up, just reply here and I will pick it up straight away.' + SIGN,
    sms: 'Hi {first}, I will close this for now. If {need} comes back up, just reply and I will pick it up.' },
]

const NURTURE: Msg = {
  subject: 'Checking in from Signarama Corona',
  email: 'Hi {first},\n\nIt has been a little while, so I wanted to check in. If any sign, banner or graphics project has come up, I would be glad to help.' + SIGN,
  sms: 'Hi {first}, checking in from Signarama Corona. Any sign or graphics project come up lately? Happy to help.',
}

export const TEMPLATES: Record<string, Msg[]> = { inquiry: INQUIRY, web_pixel: WEB_PIXEL, quoted: QUOTED, default: DEFAULT }

export type Fill = { first: string; need: string | null; ask: string | null; company: string | null; industry: string | null }


/** Pick the template for this cadence and step (0-based), fill it in. stepIndex >= steps.length = monthly check-in. */
export function stepTemplate(cadenceKey: string, stepIndex: number, f: Fill) {
  const list = TEMPLATES[cadenceKey] || DEFAULT
  const msg = stepIndex >= list.length ? NURTURE : list[Math.max(0, stepIndex)]
  const needShort = (f.need || 'sign').replace(/^your /, '').replace(/ request$/, '')
  const industry = (f.industry || '').toLowerCase().trim()
  const fill = (t: string) => t
    .replace(/\{first\}/g, f.first)
    .replace(/\{needShort\}/g, needShort)
    .replace(/\{need\}/g, f.need || 'your sign project')
    .replace(/\{ask\}/g, f.ask || 'the size you have in mind and when you need it by')
    .replace(/\{companyLike\}/g, f.company ? ` like ${f.company}` : '')
    .replace(/\{company\}/g, f.company || 'your business')
    .replace(/\{industryPlural\}/g, !industry ? 'local businesses' : /s$/.test(industry) ? industry : `${industry} businesses`)
  return { subject: fill(msg.subject), email: fill(msg.email), sms: fill(msg.sms), step: stepIndex + 1, of: list.length }
}
