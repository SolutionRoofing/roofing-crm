/** Only allow redirects to paths on this site (blocks "//evil.com" and full URLs). */
export function safeNext(value: unknown): string | null {
  const s = typeof value === 'string' ? value : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : null;
}
