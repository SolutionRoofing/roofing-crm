// Email composer tests (Node runs the TypeScript file directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMerge, buildEmail, textToHtml } from '../src/lib/email/compose.ts';

const company = { company: 'Acme Roofing', address: '100 Main St, Springfield, MO 65801' };

test('merge fields fill in; unknown ones stay visible', () => {
  assert.equal(applyMerge('Hi {{first_name}}, about {{ address }} {{oops}}', { first_name: 'Avery', address: '1 Elm' }), 'Hi Avery, about 1 Elm {{oops}}');
});

test('follow-up emails have no marketing footer', () => {
  const e = buildEmail({ subject: 'Hi {{first_name}}', body: 'Body', kind: 'followup', data: { first_name: 'Avery' }, company, unsubscribeUrl: 'https://crm.example.com/u/abc' });
  assert.equal(e.subject, 'Hi Avery');
  assert.equal(e.text, 'Body');
  assert.ok(!e.html.includes('Unsubscribe'));
});

test('marketing emails carry address and unsubscribe link (CAN-SPAM)', () => {
  const e = buildEmail({ subject: 'Storm offer', body: 'Free inspection, {{first_name}}.', kind: 'marketing', data: { first_name: 'Avery' }, company, unsubscribeUrl: 'https://crm.example.com/u/abc' });
  assert.match(e.text, /Acme Roofing, 100 Main St, Springfield, MO 65801/);
  assert.match(e.text, /unsubscribe here: https:\/\/crm\.example\.com\/u\/abc/);
  assert.match(e.html, /href="https:\/\/crm\.example\.com\/u\/abc"/);
});

test('customer data cannot inject HTML or headers', () => {
  const e = buildEmail({ subject: 'Hi {{first_name}}\r\nBcc: evil@example.com', body: 'Hello {{first_name}}', kind: 'followup', data: { first_name: '<script>x</script>' }, company });
  assert.ok(!e.subject.includes('\n') && !e.subject.includes('\r'));
  assert.ok(!e.html.includes('<script>'));
  assert.match(e.html, /&lt;script&gt;/);
});

test('links in text become clickable, paragraphs preserved', () => {
  const h = textToHtml('Line one\nline two\n\nSee https://example.com/review');
  assert.match(h, /Line one<br>line two/);
  assert.match(h, /<a href="https:\/\/example\.com\/review"[^>]*>/);
});
