// Task and calendar-event pieces shared by the job page, Tasks, Calendar and Dashboard.
import Link from 'next/link';
import { AutoSubmitCheckbox, ConfirmButton, SubmitButton } from '@/components/client';
import { createEvent, deleteEvent } from '@/app/(app)/calendar/actions';
import { createTask, deleteTask, toggleTask } from '@/app/(app)/tasks/actions';
import { fmtDay, fmtTime } from '@/lib/format';
import { EVENT_TYPES } from '@/lib/options';
import { personName, type Crew, type Person } from '@/lib/staff';

export type Task = { id: string; title: string; job_id: string | null; assignee_id: string | null; due: string | null; done: boolean; jobs?: { number: number; name: string } | null };
export type CalEvent = { id: string; title: string; type: string; job_id: string | null; assignee_id: string | null; crew_id: string | null; date: string; time: string; notes: string; jobs?: { number: number; name: string } | null };

export const TASK_COLUMNS = 'id, title, job_id, assignee_id, due, done, jobs(number, name)';
export const EVENT_COLUMNS = 'id, title, type, job_id, assignee_id, crew_id, date, time, notes, jobs(number, name)';

export function TaskRow({ task, people, today, showJob = true }: { task: Task; people: Person[]; today: string; showJob?: boolean }) {
  const who = people.find(p => p.id === task.assignee_id);
  const late = !task.done && task.due && task.due < today;
  return (
    <div className={`line-item task${task.done ? ' done' : ''}`}>
      <form action={toggleTask}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="job_id" value={task.job_id ?? ''} />
        <AutoSubmitCheckbox name="done" defaultChecked={task.done} label={`Done: ${task.title}`} />
      </form>
      <span className="grow">
        <b>{task.title}</b>
        <small>
          {[who ? personName(who) : 'Unassigned', showJob && task.jobs ? `Job #${task.jobs.number} ${task.jobs.name}` : ''].filter(Boolean).join(' · ')}
        </small>
      </span>
      {task.due && <span className={`due${late ? ' late' : ''}`}>{late ? 'Overdue · ' : ''}{fmtDay(task.due)}</span>}
      {showJob && task.job_id && <Link className="btn small hide-sm" href={`/jobs/${task.job_id}`}>Open</Link>}
      <form action={deleteTask}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="job_id" value={task.job_id ?? ''} />
        <ConfirmButton message="Delete this task?" className="icon-btn">×</ConfirmButton>
      </form>
    </div>
  );
}

export function TaskForm({ jobId, jobs, people, defaultAssignee }: {
  jobId?: string; jobs?: { id: string; label: string }[]; people: Person[]; defaultAssignee: string;
}) {
  return (
    <form action={createTask} className="inline-form add-row">
      {jobId && <input type="hidden" name="job_id" value={jobId} />}
      <input name="title" placeholder="New task, e.g. Call about estimate" required aria-label="Task" className="grow-input" />
      {jobs && (
        <select name="job_id" aria-label="Job" defaultValue="">
          <option value="">No job</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
      )}
      <select name="assignee_id" defaultValue={defaultAssignee} aria-label="Assigned to">
        <option value="">Unassigned</option>
        {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
      </select>
      <input type="date" name="due" aria-label="Due date" />
      <SubmitButton className="btn small primary" pendingText="Adding…">Add</SubmitButton>
    </form>
  );
}

export function whoLabel(e: { assignee_id: string | null; crew_id: string | null }, people: Person[], crews: Crew[]) {
  if (e.crew_id) return crews.find(c => c.id === e.crew_id)?.name ?? 'Crew';
  const p = people.find(x => x.id === e.assignee_id);
  return p ? personName(p) : '';
}

export function EventRow({ event, people, crews, showJob = true, showDate = false }: {
  event: CalEvent; people: Person[]; crews: Crew[]; showJob?: boolean; showDate?: boolean;
}) {
  return (
    <div className="line-item">
      <span className="when">{showDate ? fmtDay(event.date) : fmtTime(event.time) || 'Any time'}{showDate && event.time ? <small>{fmtTime(event.time)}</small> : null}</span>
      <span className="grow">
        <b>{event.title}</b> <span className="badge">{event.type}</span>
        <small>{[whoLabel(event, people, crews), showJob && event.jobs ? `Job #${event.jobs.number} ${event.jobs.name}` : '', event.notes].filter(Boolean).join(' · ')}</small>
      </span>
      {showJob && event.job_id && <Link className="btn small hide-sm" href={`/jobs/${event.job_id}`}>Open</Link>}
      <form action={deleteEvent}>
        <input type="hidden" name="id" value={event.id} />
        <input type="hidden" name="job_id" value={event.job_id ?? ''} />
        <ConfirmButton message="Delete this appointment?" className="icon-btn">×</ConfirmButton>
      </form>
    </div>
  );
}

export function EventForm({ jobId, jobs, people, crews, defaultDate }: {
  jobId?: string; jobs?: { id: string; label: string }[]; people: Person[]; crews: Crew[]; defaultDate: string;
}) {
  return (
    <form action={createEvent} className="form-grid">
      {jobId && <input type="hidden" name="job_id" value={jobId} />}
      <div className="field">
        <label htmlFor="ev-type">Type</label>
        <select id="ev-type" name="type" defaultValue="Inspection">{EVENT_TYPES.map(t => <option key={t}>{t}</option>)}</select>
      </div>
      <div className="field"><label htmlFor="ev-title">Title</label><input id="ev-title" name="title" placeholder="e.g. Roof inspection" /></div>
      {jobs && (
        <div className="field">
          <label htmlFor="ev-job">Job</label>
          <select id="ev-job" name="job_id" defaultValue=""><option value="">No job</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}</select>
        </div>
      )}
      <div className="field">
        <label htmlFor="ev-who">Who</label>
        <select id="ev-who" name="who" defaultValue="">
          <option value="">Nobody yet</option>
          <optgroup label="Team">{people.map(p => <option key={p.id} value={`p:${p.id}`}>{personName(p)}</option>)}</optgroup>
          {crews.length > 0 && <optgroup label="Crews">{crews.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>}
        </select>
      </div>
      <div className="field"><label htmlFor="ev-date">Date</label><input id="ev-date" type="date" name="date" defaultValue={defaultDate} required /></div>
      <div className="field"><label htmlFor="ev-time">Time</label><input id="ev-time" type="time" name="time" /></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ev-notes">Notes</label><input id="ev-notes" name="notes" /></div>
      <div style={{ gridColumn: '1 / -1' }}>
        <SubmitButton className="btn primary" pendingText="Adding…">Add to calendar</SubmitButton>
        <small style={{ display: 'inline', marginLeft: 10 }}>An Install or Inspection moves the job forward automatically.</small>
      </div>
    </form>
  );
}
