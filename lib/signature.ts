// Email signature added to every email sent from the CRM. Gmail only adds the signature saved in
// Gmail settings when you send from Gmail itself, so the CRM keeps its own copy (Settings → Email signature).
// Default = the outreach@ Gmail signature as of 2026-11-19.

export const SIGNATURE_KEY = 'email_signature'
export type Signature = { enabled: boolean; html: string }

export const DEFAULT_SIGNATURE_HTML = `<p style="margin:0 0 2px;padding:0;font-size:medium;font-weight:700;color:#1a1a1a;font-family:Arial,sans-serif">Orlando Jimenez</p>
<p style="margin:0 0 10px;padding:0;font-size:13px;color:#555555;font-family:Arial,sans-serif">Business Development Representative&nbsp;&nbsp;|&nbsp;&nbsp;Signarama Corona</p>
<div style="margin:0 0 10px;padding:0;font-size:18px;font-weight:700;color:#e30613;letter-spacing:1px;font-family:Arial,sans-serif">SIGNARAMA</div>
<div style="margin:0;padding:0;font-size:12px;color:#444444;line-height:1.8;font-family:Arial,sans-serif">
<div><strong>Corona, CA</strong></div>
<div><a href="mailto:outreach@signarama-corona.com">outreach@signarama-corona.com</a></div>
<div><a href="https://signarama.com/locations/ca-corona">signarama.com/locations/ca-corona</a></div>
</div>
<p style="margin:8px 0 0;padding:0;font-size:11px;color:#999999;font-style:italic;font-family:Arial,sans-serif">Signs. Graphics. Results.</p>`

export const DEFAULT_SIGNATURE: Signature = { enabled: true, html: DEFAULT_SIGNATURE_HTML }

/** Plain-text version for the text part of the email. */
export function signatureText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (_, href: string, t: string) => (href.startsWith('mailto:') || t.includes(href.replace(/^https?:\/\//, '')) ? t : `${t} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The typed message as simple HTML: paragraphs, line breaks, clickable links. */
export function bodyHtml(text: string) {
  return esc(text.trim())
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split(/\n{2,}/).map(p => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('')
}
