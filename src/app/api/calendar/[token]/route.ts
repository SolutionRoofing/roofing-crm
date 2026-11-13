import { type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from '@/lib/env';
import { buildIcs, type FeedItem } from '@/lib/calendar';

// Private calendar link for Google / Apple / Outlook. The secret token is checked in the
// database (calendar_feed); a wrong or reset token just gets an empty calendar.
// /api/calendar/<token>.ics = my appointments, ?all=1 = everyone's.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/i, '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response('Not found', { status: 404 });
  const all = request.nextUrl.searchParams.get('all') === '1';
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('calendar_feed', { p_token: token, p_all: all });
  if (error) return new Response('Calendar unavailable', { status: 500 });
  const items = (data ?? []) as FeedItem[];
  const body = buildIcs(items, {
    name: all ? 'Solution Roofing · Everyone' : 'Solution Roofing · My appointments',
    tz: process.env.BUSINESS_TIMEZONE || 'America/New_York',
    host: request.nextUrl.host,
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="solution-roofing${all ? '-everyone' : ''}.ics"`,
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  });
}
