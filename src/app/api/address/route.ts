import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { placeDetails, suggest } from '@/lib/address';

// Address suggestions for signed-in staff. ?q=<typed text> lists matches;
// ?place=<id> fills in the parts of a Google match. `s` groups one lookup's requests.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const session = (params.get('s') ?? '').slice(0, 64);
  try {
    const place = params.get('place');
    if (place) return NextResponse.json({ parts: await placeDetails(place, session) });
    const q = (params.get('q') ?? '').trim().slice(0, 120);
    if (q.length < 4) return NextResponse.json({ suggestions: [] });
    return NextResponse.json({ suggestions: await suggest(q, session) });
  } catch (e) {
    console.error('address lookup failed', e);
    return NextResponse.json({ suggestions: [], error: 'lookup failed' }, { status: 502 });
  }
}
