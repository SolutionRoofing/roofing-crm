import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from '@/lib/env';

// One-click unsubscribe (RFC 8058): Gmail and Yahoo POST here from their own
// "Unsubscribe" button. The token is checked in the database.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { auth: { persistSession: false } });
  const { data } = await sb.rpc('unsubscribe_contact', { p_token: token });
  return NextResponse.json({ ok: Boolean(data) }, { status: data ? 200 : 404 });
}
