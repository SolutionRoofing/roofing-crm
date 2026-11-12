import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processOutbox } from '@/lib/email/send';

// Called every 30 minutes by GitHub Actions (.github/workflows/send-emails.yml)
// and once a day by Vercel Cron (vercel.json, the Hobby plan limit). Both send
// "Authorization: Bearer <CRON_SECRET>". Sends whatever is due in the outbox.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await processOutbox(100));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
