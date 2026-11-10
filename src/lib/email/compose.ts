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
    const safe = escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}">${url}</a>`);
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
};

export function buildEmail({ subject, body, kind, data, company, unsubscribeUrl }: BuildInput) {
  const finalSubject = applyMerge(subject, data).replace(/[\r\n]+/g, ' ').trim();
  let text = applyMerge(body, data).trim();
  let footerHtml = '';
  if (kind === 'marketing') {
    // CAN-SPAM: identify the sender, give a physical mailing address and a working opt-out.
    const who = [company.company, company.address].filter(Boolean).join(', ');
    const optOut = unsubscribeUrl ? `To stop receiving these emails, unsubscribe here: ${unsubscribeUrl}` : 'To stop receiving these emails, reply with UNSUBSCRIBE.';
    text += `\n\n--\n${who}\n${optOut}`;
    footerHtml = `<hr style="border:0;border-top:1px solid #ddd;margin:20px 0 10px">
<p style="margin:0;color:#666;font-size:12px">${escapeHtml(who)}<br>${unsubscribeUrl
      ? `Don't want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#666">Unsubscribe</a>.`
      : 'To stop receiving these emails, reply with UNSUBSCRIBE.'}</p>`;
    text = text.replace(/\n{3,}/g, '\n\n');
  }
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f2ee">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:24px;font:15px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;color:#1d2730">
${textToHtml(applyMerge(body, data).trim())}${footerHtml}
</div></body></html>`;
  return { subject: finalSubject, text, html };
}
