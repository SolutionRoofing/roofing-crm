'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { StageSelect } from '@/components/client';
import type { JobRow } from '@/lib/jobs';
import { daysSince, money } from '@/lib/format';
import { changeStage } from '../jobs/actions';

type Stage = { id: string; name: string };

/**
 * Pipeline board: drag a card to another column to move the job there.
 * The card moves at once; the save runs in the background and the page refreshes with
 * the server's view. Phones keep the stage picker on each card.
 */
export function PipelineBoard({ stages, jobs }: { stages: Stage[]; jobs: JobRow[] }) {
  // Moves made here: shown until the server's data catches up (its stage no longer equals `from`).
  const [moved, setMoved] = useState<Record<string, { from: string; to: string }>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [, start] = useTransition();
  const boardRef = useRef<HTMLDivElement>(null);

  const pending = (j: JobRow) => (moved[j.id]?.from === j.stage ? moved[j.id] : undefined);
  const stageOf = (j: JobRow) => pending(j)?.to ?? j.stage;
  const byStage = new Map<string, JobRow[]>(stages.map(s => [s.id, []]));
  for (const j of jobs) byStage.get(stageOf(j))?.push(j);

  const move = (jobId: string, to: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || stageOf(job) === to) return;
    const fd = new FormData();
    fd.set('id', jobId);
    fd.set('stage', to);
    if (to === 'lost') {
      const reason = window.prompt('Why was this job lost? (e.g. went with a competitor, price, claim denied)');
      if (reason === null) return;
      fd.set('lost_reason', reason);
    }
    setError('');
    setMoved(m => ({ ...m, [jobId]: { from: job.stage, to } }));
    start(async () => {
      try {
        await changeStage(fd);
      } catch {
        setMoved(m => { const rest = { ...m }; delete rest[jobId]; return rest; });
        setError(`Could not move ${job.customer_name || job.name}. Try again.`);
      }
    });
  };

  // Scroll the board sideways when dragging near its left or right edge.
  const edgeScroll = (e: React.DragEvent) => {
    const b = boardRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    if (e.clientX < r.left + 60) b.scrollLeft -= 18;
    else if (e.clientX > r.right - 60) b.scrollLeft += 18;
  };

  return (
    <>
      {error && <div className="form-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="board" ref={boardRef} onDragOver={dragId ? edgeScroll : undefined}>
        {stages.map(s => {
          const list = byStage.get(s.id) ?? [];
          return (
            <section
              key={s.id}
              aria-label={s.name}
              className={over === s.id ? 'col drop' : 'col'}
              onDragOver={e => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== s.id) setOver(s.id); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(o => (o === s.id ? null : o)); }}
              onDrop={e => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/x-job') || dragId;
                setOver(null); setDragId(null);
                if (id) move(id, s.id);
              }}
            >
              <div className="col-head">
                <h2>{s.name}</h2><span className="muted">{list.length}</span>
                <span className="col-sum">{money(list.reduce((sum, j) => sum + Number(j.amount), 0))}</span>
              </div>
              <div className="col-body">
                {list.length === 0 && <div className="col-empty">{dragId ? 'Drop here' : 'No jobs'}</div>}
                {list.map(j => {
                  const days = pending(j) ? 0 : daysSince(j.stage_changed_at);
                  return (
                    <article
                      className={dragId === j.id ? 'card link-card dragging' : 'card link-card'}
                      key={j.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('text/x-job', j.id); e.dataTransfer.effectAllowed = 'move'; setDragId(j.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                    >
                      <Link href={`/jobs/${j.id}`} className="card-link" draggable={false}>
                        <div className="card-top"><b>{j.customer_name || j.name}</b>{j.type === 'Insurance' && <span className="pill">Claim</span>}</div>
                        <div className="card-addr">{j.address || j.name}</div>
                        <div className="card-foot">
                          <span className="num">{money(j.amount)}</span>
                          <span className={days >= 14 ? 'late' : undefined}>{days}d{j.rep_name ? ` · ${j.rep_name.split(' ')[0]}` : ''}</span>
                        </div>
                      </Link>
                      <StageSelect action={changeStage} jobId={j.id} stage={stageOf(j)} compact />
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
