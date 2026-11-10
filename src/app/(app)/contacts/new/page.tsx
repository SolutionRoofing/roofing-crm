import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { SubmitButton } from '@/components/client';
import { ContactFields } from '@/components/contact-fields';
import { requireUser } from '@/lib/auth';
import { createContact } from '../actions';

export const metadata: Metadata = { title: 'Add customer' };

export default function NewContactPage() {
  return (
    <>
      <Link className="crumb" href="/contacts"><Icon name="back" size={14} /> Customers</Link>
      <div className="page-head"><h1>Add customer</h1></div>
      <Suspense fallback={null}><Form /></Suspense>
    </>
  );
}

async function Form() {
  await requireUser(['owner', 'office', 'rep']);
  return (
    <form action={createContact} className="panel">
      <p className="muted" style={{ marginBottom: 12 }}>To add a customer with a job at the same time, use <Link href="/jobs/new">New lead</Link> instead.</p>
      <div className="form-grid"><ContactFields /></div>
      <div style={{ marginTop: 12 }}><SubmitButton>Add customer</SubmitButton></div>
    </form>
  );
}
