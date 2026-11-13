import { STAGES } from '@/lib/stages';

/** A row of the job_list view. */
export type JobRow = {
  id: string;
  number: number;
  name: string;
  stage: string;
  stage_changed_at: string;
  type: 'Retail' | 'Insurance';
  roof_type: string;
  squares: number;
  pitch: string;
  rep_id: string | null;
  crew_id: string | null;
  contact_id: string | null;
  sold_at: string | null;
  lost_reason: string;
  created_at: string;
  customer_name: string;
  address: string;
  city: string;
  phone: string;
  rep_name: string;
  amount: number;
  services: string[];
};

export const JOB_LIST_COLUMNS =
  'id, number, name, stage, stage_changed_at, type, roof_type, squares, pitch, rep_id, crew_id, contact_id, sold_at, lost_reason, created_at, customer_name, address, city, phone, rep_name, amount, services';

export const stageOf = (id: string) => STAGES.find(s => s.id === id) ?? STAGES[0];

export function StageBadge({ stage }: { stage: string }) {
  const s = stageOf(stage);
  return <span className={`badge stage-${s.group}`}>{s.name}</span>;
}
