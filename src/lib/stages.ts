// Mirrors the prototype's pipeline and the CHECK constraint on jobs.stage.
export const STAGES = [
  { id: 'lead', name: 'New Lead', group: 'sales' },
  { id: 'insp', name: 'Inspection Set', group: 'sales' },
  { id: 'inspected', name: 'Inspected', group: 'sales' },
  { id: 'estimate', name: 'Estimate Sent', group: 'sales' },
  { id: 'claim', name: 'Claim In Review', group: 'sales' },
  { id: 'sold', name: 'Sold', group: 'production' },
  { id: 'materials', name: 'Materials Ordered', group: 'production' },
  { id: 'scheduled', name: 'Install Scheduled', group: 'production' },
  { id: 'progress', name: 'In Progress', group: 'production' },
  { id: 'complete', name: 'Completed', group: 'billing' },
  { id: 'invoiced', name: 'Invoiced', group: 'billing' },
  { id: 'paid', name: 'Paid', group: 'closed' },
  { id: 'lost', name: 'Lost', group: 'closed' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];
