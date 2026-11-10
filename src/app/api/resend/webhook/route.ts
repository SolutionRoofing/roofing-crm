import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

// Resend calls this when an email is delivered, opened, bounces or is marked as spam.
// Requests are signed (Svix format); anything without a valid, recent signature is rejected.
function verify(req: NextRequest, raw: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigs = req.headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest();
  return sigs.split(' ').some(s => {
    const [version, sig] = s.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type Event = { type: string; created_at?: string; data?: { email_id?: string; bounce?: { message?: string } } };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verify(request, raw)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  const event = JSON.parse(raw) as Event;
  const providerId = event.data?.email_id;
  if (!providerId) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  const at = event.created_at ?? new Date().toISOString();
  const byId = () => db.from('outbox').select('id, contact_id, delivered_at, opened_at').eq('provider_id', providerId).maybeSingle();

  switch (event.type) {
    case 'email.delivered':
      await db.from('outbox').update({ delivered_at: at }).eq('provider_id', providerId).is('delivered_at', null);
      break;
    case 'email.opened':
      await db.from('outbox').update({ opened_at: at }).eq('provider_id', providerId).is('opened_at', null);
      break;
    case 'email.bounced':
      await db.from('outbox').update({ bounced_at: at, status: 'failed', reason: `Bounced: ${event.data?.bounce?.message ?? 'address rejected'}` }).eq('provider_id', providerId);
      break;
    case 'email.complained': {
      // Marked as spam: stop all marketing to this person.
      const { data: row } = await byId();
      await db.from('outbox').update({ reason: 'Customer marked this as spam' }).eq('provider_id', providerId);
      if (row?.contact_id) {
        await db.from('contacts').update({ marketing: false, unsubscribed_at: at }).eq('id', row.contact_id);
        await db.from('outbox').update({ status: 'cancelled', reason: 'Customer marked an email as spam' })
          .eq('contact_id', row.contact_id).eq('kind', 'marketing').eq('status', 'scheduled');
      }
      break;
    }
  }
  return NextResponse.json({ ok: true });
}
