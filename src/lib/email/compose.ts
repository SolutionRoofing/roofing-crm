// Builds the final email from a template: fills in {{merge_fields}}, adds the
// legally required footer to marketing emails, and makes plain-text + HTML versions.
// No imports, so it can be unit-tested directly with Node.

export const MERGE_KEYS = [
  'first_name', 'last_name', 'full_name', 'address', 'job_number', 'company',
  'company_phone', 'rep_name', 'estimate_total', 'review_link',
] as const;

export type MergeData = Partial<Record<(typeof MERGE_KEYS)[number], string>>;

/** Replaces {{key}} with data[key]; unknown keys are left as written so mistakes are visible. */
export function applyMerge(text: string, data: MergeData): string {
  return String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) =>
    (k in data && data[k as keyof MergeData] !== undefined ? String(data[k as keyof MergeData]) : m));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Plain text to simple, safe HTML: paragraphs, line breaks and clickable links. */
export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map(p => {
    const safe = escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}" style="color:#054123;font-weight:600">${url}</a>`);
    return `<p style="margin:0 0 14px">${safe.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export type BuildInput = {
  subject: string;
  body: string;
  kind: 'followup' | 'marketing' | string;
  data: MergeData;
  company: { company: string; address: string };
  unsubscribeUrl?: string;
  /** Full URL of the logo image shown at the top (emails need an absolute link). */
  logoUrl?: string;
};

export function buildEmail({ subject, body, kind, data, company, unsubscribeUrl, logoUrl }: BuildInput) {
  const finalSubject = applyMerge(subject, data).replace(/[\r\n]+/g, ' ').trim();
  let text = applyMerge(body, data).trim();
  let footerHtml = '';
  if (kind === 'marketing') {
    // CAN-SPAM: identify the sender, give a physical mailing address and a working opt-out.
    const who = [company.company, company.address].filter(Boolean).join(', ');
    const optOut = unsubscribeUrl ? `To stop receiving these emails, unsubscribe here: ${unsubscribeUrl}` : 'To stop receiving these emails, reply with UNSUBSCRIBE.';
    text += `\n\n--\n${who}\n${optOut}`;
    footerHtml = `<hr style="border:0;border-top:1px solid #E3D7BE;margin:20px 0 10px">
<p style="margin:0;color:#56664F;font-size:12px">${escapeHtml(who)}<br>${unsubscribeUrl
      ? `Don't want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#56664F">Unsubscribe</a>.`
      : 'To stop receiving these emails, reply with UNSUBSCRIBE.'}</p>`;
    text = text.replace(/\n{3,}/g, '\n\n');
  }
  // Solution Roofing look: cream page, logo on cream, Shell Green rule, two-beat tagline.
  const header = logoUrl
    ? `<div style="text-align:center;padding:4px 0 14px"><img src="${escapeHtml(logoUrl)}" width="132" alt="${escapeHtml(company.company || 'Logo')}" style="display:inline-block;width:132px;height:auto;border:0"></div>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#FFFCF5">
<div style="max-width:560px;margin:0 auto">${header}
<div style="background:#fff;border:1px solid #E3D7BE;border-top:5px solid #054123;padding:24px;font:15px/1.55 'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,sans-serif;color:#3B4A40">
${textToHtml(applyMerge(body, data).trim())}${footerHtml}
</div>
<p style="margin:14px 0 0;text-align:center;font:700 13px/1.4 Arial,sans-serif;color:#054123">Turtle-Tough Roofs. <span style="color:#E4691A">Honest Answers.</span></p>
</div></body></html>`;
  return { subject: finalSubject, text, html };
}
