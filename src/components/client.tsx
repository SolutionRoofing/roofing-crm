'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { createClient } from '@/lib/supabase/browser';
import { STAGES } from '@/lib/stages';

/** Stage picker that saves as soon as it changes. Asks for a reason when a job is marked lost. */
export function StageSelect({ action, jobId, stage, compact }: {
  action: (fd: FormData) => Promise<void>; jobId: string; stage: string; compact?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Arrow keys on a focused select fire a change per step; wait until the choice settles
  // so a job isn't moved through every stage in between (each move can queue emails).
  const submitSoon = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => formRef.current?.requestSubmit(), delay);
  };
  return (
    // key: redraw when the stage changes elsewhere (automation, another user), so the picker never shows a stale stage.
    <form key={stage} ref={formRef} action={action} className={compact ? 'stage-pick compact' : 'stage-pick'}>
      <input type="hidden" name="id" value={jobId} />
      <input type="hidden" name="lost_reason" ref={reasonRef} />
      {!compact && <span>Stage</span>}
      <select
        name="stage"
        defaultValue={stage}
        aria-label="Job stage"
        onChange={e => {
          clearTimeout(timer.current);
          if (e.target.value === stage) return;
          if (e.target.value === 'lost') {
            const reason = window.prompt('Why was this job lost? (e.g. went with a competitor, price, claim denied)');
            if (reason === null) { e.target.value = stage; return; }
            if (reasonRef.current) reasonRef.current.value = reason;
            formRef.current?.requestSubmit();
            return;
          }
          submitSoon(900);
        }}
        onBlur={e => { if (e.target.value !== stage) submitSoon(0); }}
      >
        {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </form>
  );
}

/** Submit button that asks first. */
export function ConfirmButton({ message, children, className = 'btn danger-ghost' }: {
  message: string; children: React.ReactNode; className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} onClick={e => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}

/** Submit button that shows progress. */
export function SubmitButton({ children, className = 'btn primary', pendingText = 'Saving…' }: {
  children: React.ReactNode; className?: string; pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? pendingText : children}</button>;
}

/** Checkbox that submits its form when ticked (task done/undone). */
export function AutoSubmitCheckbox({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <input type="checkbox" name={name} defaultChecked={defaultChecked} aria-label={label}
      onChange={e => e.currentTarget.form?.requestSubmit()} />
  );
}

/**
 * Refreshes the page when shared data changes elsewhere (another rep moves a job,
 * a crew marks a job done). Uses Supabase Realtime, which respects row-level security.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 700);
    };
    const channel = supabase.channel('crm-live');
    for (const table of ['jobs', 'contacts', 'tasks', 'events', 'work_orders', 'job_activity']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
