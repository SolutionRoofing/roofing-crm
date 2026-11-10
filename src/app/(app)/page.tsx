import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';

export default function Home() {
  return (
    <Suspense fallback={null}>
      <SendHome />
    </Suspense>
  );
}

async function SendHome(): Promise<null> {
  const user = await requireUser();
  redirect(user.role === 'crew' ? '/work-orders' : '/dashboard');
}
