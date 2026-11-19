// How big is this lead, who should work it, and is the contact the decision maker.
// Pure rules, no AI calls: cheap, instant and the same answer every time.
// Price ranges are typical Signarama job sizes; edit them here as you learn real numbers.

export type Size = 'large' | 'medium' | 'small' | 'not_a_fit' | 'unknown'

type Rule = { match: RegExp; label: string; low: number; high: number; fit?: false }

// First match wins, so the bigger / more specific products come first.
export const PRODUCTS: Rule[] = [
  { match: /shirt|apparel|embroider|\bhats?\b|hoodie|uniform|mug|\bpens?\b|promo|business card|flyer|brochure|screen ?print/i, label: 'Not something we make', low: 0, high: 0, fit: false },
  { match: /pylon|pole sign|freeway sign/i, label: 'Pylon / pole sign', low: 15000, high: 80000 },
  { match: /monument/i, label: 'Monument sign', low: 8000, high: 40000 },
  { match: /channel letter|illuminated|lit sign|light ?box|cabinet sign|neon|blade sign/i, label: 'Illuminated building sign', low: 4000, high: 20000 },
  { match: /building sign|storefront|exterior|outdoor|outside sign|facade|wall sign|business sign|new business name|suite sign|tenant sign/i, label: 'Building / exterior sign', low: 1500, high: 7000 },
  { match: /fleet/i, label: 'Fleet graphics', low: 6000, high: 30000 },
  { match: /wayfinding|directory|ada|braille|room sign|interior sign|office sign|lobby/i, label: 'Interior / ADA / wayfinding signs', low: 1500, high: 10000 },
  { match: /full wrap|vehicle wrap|car wrap|truck wrap|van wrap|wrap/i, label: 'Vehicle wrap', low: 2500, high: 6000 },
  { match: /mural|wall graphic|wall wrap|wallpaper/i, label: 'Wall graphics / mural', low: 800, high: 5000 },
  { match: /window|frosted|vinyl lettering|storefront graphic/i, label: 'Window graphics', low: 400, high: 3000 },
  { match: /trade ?show|booth|pop.?up display|backdrop|step and repeat|table ?(cloth|throw|cover)/i, label: 'Trade show display', low: 400, high: 3500 },
  { match: /vehicle|car|truck|van|magnet|lettering|door decal/i, label: 'Vehicle lettering / magnets', low: 250, high: 1500 },
  { match: /post.?and.?panel|real estate|construction sign|site sign|job ?site/i, label: 'Site / real estate signs', low: 200, high: 2500 },
  { match: /a.?frame|sandwich|sidewalk|feather|flag|yard sign|coroplast|lawn/i, label: 'Portable signs', low: 100, high: 900 },
  { match: /banner|retractable|roll.?up/i, label: 'Banners', low: 80, high: 900 },
  { match: /sticker|decal|label/i, label: 'Stickers / decals', low: 60, high: 700 },
  { match: /poster|print|foam ?board|canvas|menu board|acrylic sign|plaque|sign/i, label: 'Printed signs', low: 100, high: 1200 },
]

// Customers whose jobs tend to be bigger or come back again.
const BIG_BUYER = /property manag|general contractor|construction|developer|school|district|college|universit|city of|county|government|hospital|medical center|church|franchise|hotel|dealership|apartment|hoa|shopping center|plaza/i

export type RoutingSettings = {
  large: string | null       // profile id
  medium: string | null
  small: string | null
  largeMin: number           // estimated value (mid-point) at or above this is Large
  smallMax: number           // at or below this is Small
  autoWelcome: boolean
  welcomeText: string
}
export const ROUTING_KEY = 'lead_routing'
export const DEFAULT_WELCOME =
  "Hi {first}, this is Signarama Corona. Thanks for your request{about}! We've got it and someone from our team will call you shortly to go over the details. You can also reply to this text. Reply STOP to opt out."
export const DEFAULT_ROUTING: RoutingSettings = {
  large: null, medium: null, small: null, largeMin: 5000, smallMax: 1000, autoWelcome: true, welcomeText: DEFAULT_WELCOME,
}

export type Estimate = {
  size: Size; low: number; high: number; product: string | null; reasons: string[]; rush: boolean
}

const money = (n: number) => `$${n >= 1000 ? `${Math.round(n / 100) / 10}k`.replace('.0k', 'k') : Math.round(n)}`
export const rangeText = (low: number, high: number) => (high ? `${money(low)}–${money(high)}` : '—')

/** Pull a dollar figure out of a budget answer such as "around $3,000" or "2-5k". */
function budgetFrom(text: string) {
  const m = text.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?/gi)
  if (!m) return null
  const nums = m.map(x => {
    const n = parseFloat(x.replace(/[^\d.]/g, ''))
    return /k|thousand/i.test(x) ? n * 1000 : n
  }).filter(n => n >= 50 && n < 1_000_000)
  return nums.length ? Math.max(...nums) : null
}

export type IntakeInput = {
  product?: string | null; inquiry?: string | null; company?: string | null; industry?: string | null
  employees?: number | null; qa?: { q: string; a: string }[]
}

export function estimate(i: IntakeInput, s: Pick<RoutingSettings, 'largeMin' | 'smallMax'> = DEFAULT_ROUTING): Estimate {
  const text = [i.product, i.inquiry, ...(i.qa || []).filter(x => /type of sign|signage\?|what kind/i.test(x.q)).map(x => x.a)].filter(Boolean).join(' ')
  const all = [text, ...(i.qa || []).map(x => x.a)].join(' ')
  const reasons: string[] = []
  const rule = PRODUCTS.find(r => r.match.test(i.product || '')) || PRODUCTS.find(r => r.match.test(text))
  const who0 = [i.company, i.industry, all].filter(Boolean).join(' ')
  if (!rule) {
    // No idea what they want (e.g. a website visitor): do not invent a number. Only flag clearly big accounts.
    const big = (i.employees || 0) >= 200 || BIG_BUYER.test(who0)
    return { size: big ? 'large' : 'unknown', low: 0, high: 0, product: null, rush: false,
      reasons: big ? [(i.employees || 0) >= 200 ? `Larger company (about ${i.employees} employees): worth a senior call` : 'Type of customer that buys bigger or repeat jobs'] : ['Not enough information to size yet'] }
  }
  let low = rule.low, high = rule.high
  reasons.push(`${rule.label}: usually ${rangeText(rule.low, rule.high)}`)
  if (rule.fit !== false && /\b(small|tiny|little|simple|single|just one|one small)\b|\b\d{1,2}(?:"|”|''| ?inch)/i.test(text)) {
    high = Math.max(low * 2, Math.round(high * 0.4)); reasons.push('Described as small or simple')
  }
  if (rule.fit === false) return { size: 'not_a_fit', low: 0, high: 0, product: rule.label, reasons: ['Signarama does not offer this (apparel, promo items or print collateral)'], rush: false }

  const locAns = (i.qa || []).find(x => /locations|vehicles/i.test(x.q))?.a || ''
  // Only count numbers attached to locations or vehicles ("4 vans", "two stores"), not "6 stickers".
  const UNIT = '(?:locations?|stores?|sites?|shops?|vehicles?|vans?|trucks?|cars?|buildings?|offices?|branches|restaurants?)'
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, several: 3, multiple: 3 }
  const lm = locAns.match(new RegExp(`\\b(\\d{1,3}|two|three|four|five|six|several|multiple)\\s+(?:\\w+\\s+)?${UNIT}\\b`, 'i'))
  const locs = lm ? (Number(lm[1]) || WORDS[lm[1].toLowerCase()] || 1) : 1
  if (locs > 1) { const k = Math.min(locs, 6); low *= k; high *= k; reasons.push(`${locs} locations or vehicles`) }

  const budgetAns = (i.qa || []).find(x => /budget/i.test(x.q))?.a || ''
  const budget = budgetAns ? budgetFrom(budgetAns) : null
  if (budget) { reasons.push(`Budget mentioned: ${money(budget)}`); low = budget * 0.8; high = budget * 1.2 } // what they said beats the catalogue

  const who = [i.company, i.industry, all].filter(Boolean).join(' ')
  let bump = false
  if (BIG_BUYER.test(who)) { bump = true; reasons.push('Type of customer that buys bigger or repeat jobs') }
  if ((i.employees || 0) >= 200) { bump = true; reasons.push(`Larger company (about ${i.employees} employees)`) }

  const mid = (low + high) / 2
  let size: Size = mid >= s.largeMin ? 'large' : mid <= s.smallMax ? 'small' : 'medium'
  if (bump && size !== 'large') size = size === 'small' ? 'medium' : 'large'
  const rush = /asap|urgent|rush|this (monday|tuesday|wednesday|thursday|friday|weekend|week)|tomorrow|by (monday|friday)|before (sunday|the weekend)/i.test(all)
  if (rush) reasons.push('Tight deadline: call today')
  return { size, low: Math.round(low), high: Math.round(high), product: rule.label, reasons, rush }
}

export type DecisionMaker = { value: 'yes' | 'likely' | 'no' | 'unknown'; why: string }

/** From the qualifier's answer first (they told us), then from the job title. */
export function decisionMaker(title: string | null | undefined, qa?: { q: string; a: string }[]): DecisionMaker {
  const ans = (qa || []).find(x => /decision/i.test(x.q))?.a?.trim()
  if (ans) {
    if (/landlord|corporate|hoa|approv|board|boss|manager has to|partner has to|need to check|not the decision/i.test(ans)) return { value: 'no', why: `Needs approval: ${ans.slice(0, 120)}` }
    if (/\b(yes|i am|i'm|owner|my business|decision.?maker|i decide|i make)\b/i.test(ans)) return { value: 'yes', why: `Said: ${ans.slice(0, 120)}` }
  }
  const t = (title || '').toLowerCase()
  if (/owner|founder|president|ceo|principal|proprietor|partner|general manager|\bgm\b|managing director|chief/.test(t)) return { value: 'yes', why: `Title: ${title}` }
  if (/director|vp|vice president|head of|manager/.test(t)) return { value: 'likely', why: `Title: ${title} (may need sign-off)` }
  if (/assistant|coordinator|admin|intern|associate|specialist|receptionist|clerk/.test(t)) return { value: 'no', why: `Title: ${title}: probably gathering quotes for someone else` }
  return { value: 'unknown', why: 'Not known yet: ask "Who else is involved in the decision?"' }
}

export const SIZE_LABEL: Record<Size, string> = { large: 'Large', medium: 'Medium', small: 'Small', not_a_fit: 'Not a fit', unknown: 'Size unknown' }
export const SIZE_COLOR: Record<Size, string> = { large: '#F59E0B', medium: '#3B82F6', small: '#64748B', not_a_fit: '#EF4444', unknown: '#64748B' }
export const DM_LABEL: Record<DecisionMaker['value'], string> = { yes: 'Decision maker', likely: 'Likely decides', no: 'Needs approval', unknown: 'Decision maker?' }

/** Read the sizing tags the intake step writes. */
export function sizeOf(tags: string[] | null | undefined) {
  const t = tags || []
  const size = t.find(x => x.startsWith('size:'))?.slice(5) as Size | undefined
  const est = t.find(x => x.startsWith('est:'))?.slice(4).split('-').map(Number)
  const dm = t.find(x => x.startsWith('dm:'))?.slice(3) as DecisionMaker['value'] | undefined
  return { size: size || null, low: est?.[0] ?? null, high: est?.[1] ?? null, dm: dm || null, rush: t.includes('rush') }
}

export function routeFor(size: Size | null, r: RoutingSettings) {
  if (!size || size === 'unknown') return null
  if (size === 'large') return r.large
  if (size === 'small' || size === 'not_a_fit') return r.small
  return r.medium
}

export type IntakePayload = {
  product?: string | null; inquiry?: string | null; address?: string | null; zip?: string | null
  summary?: string | null; status?: string | null; qa?: { q: string; a: string }[]
}

/** Read an Intake brief note back into its parts. */
export function parseBrief(body: string): IntakePayload & { sizeLine?: string | null; why?: string | null } {
  if (!body) return {}
  const line = (k: string) => (body.match(new RegExp(`^${k}: (.+)$`, 'm')) || [])[1] || null
  const size = line('Size'), why = line('Why'), address = line('Job address')
  const want = line('What they want')
  const qa: { q: string; a: string }[] = []
  for (const m of body.matchAll(/^Q: (.+)\nA: (.+)$/gm)) qa.push({ q: m[1], a: m[2].startsWith('(not answered') ? '' : m[2] })
  const [product, ...rest] = (want || '').split(' — ')
  return {
    product: rest.length ? product : null, inquiry: rest.length ? rest.join(' — ') : want,
    summary: line('Revscale summary'), status: line('Qualifier status'), qa, address, sizeLine: size, why,
  }
}

