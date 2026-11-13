// Turns a prototype backup ("Download backup" in the prototype's Settings) into rows for
// the multi-user database. Pure function: no network or database access.
import { randomUUID } from 'node:crypto';

const STAGES = ['lead', 'insp', 'inspected', 'estimate', 'claim', 'sold', 'materials', 'scheduled', 'progress', 'complete', 'invoiced', 'paid', 'lost'];
const DOC_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'void'];
const OUTBOX_STATUSES = ['scheduled', 'sent', 'cancelled', 'skipped', 'failed'];

const iso = ms => (ms ? new Date(Number(ms)).toISOString() : null);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = v => (v == null ? '' : String(v));
const dateOrNull = v => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? v : null);
const norm = s => str(s).trim().toLowerCase();

export function isPrototypeBackup(data) {
  return !!data && data.app === 'roofing-crm' && !!data.state && Array.isArray(data.state.jobs);
}

/**
 * @param {object} backup   parsed backup JSON
 * @param {object} opts
 * @param {boolean} [opts.includeSample]  also import the prototype's sample records
 * @param {{id: string, full_name: string, email?: string}[]} [opts.profiles]  existing logins, matched to team members by name
 */
export function transformBackup(backup, { includeSample = false, profiles = [] } = {}) {
  if (!isPrototypeBackup(backup)) throw new Error('That file is not a Roofing CRM prototype backup.');
  const s = backup.state;
  const warnings = [];
  const ids = new Map();
  const nid = old => {
    if (!old) return null;
    if (!ids.has(old)) ids.set(old, randomUUID());
    return ids.get(old);
  };
  const keep = x => includeSample || !x.sample;

  // ---- team: crews become crew records; everyone else is matched to a login by name
  const crewIds = new Map();
  const profileIds = new Map();
  const crews = [];
  for (const m of (s.team || []).filter(keep)) {
    if (m.type === 'crew' || /crew/i.test(str(m.role))) {
      const id = nid(m.id);
      crewIds.set(m.id, id);
      crews.push({ id, name: str(m.name) || 'Crew', lead_name: '', phone: '', email: '', active: true, legacy_id: m.id });
    } else {
      const match = profiles.find(p => norm(p.full_name) === norm(m.name));
      if (match) profileIds.set(m.id, match.id);
      else warnings.push(`No login matches team member "${m.name}". Their jobs, tasks and events will be unassigned. Invite them first, using the same name, then re-run the import on a fresh database to keep assignments.`);
    }
  }
  const crewNamed = new Map((s.team || []).map(m => [m.id, m.name]));

  // ---- jobs (decide first, so their contacts are kept even if marked sample)
  const srcJobs = (s.jobs || []).filter(keep);
  const jobIds = new Set(srcJobs.map(j => j.id));
  const usedContacts = new Set(srcJobs.map(j => j.contactId).filter(Boolean));

  const contacts = (s.contacts || []).filter(c => keep(c) || usedContacts.has(c.id)).map(c => ({
    id: nid(c.id), first: str(c.first), last: str(c.last), phone: str(c.phone), email: str(c.email).trim(),
    address: str(c.address), city: str(c.city), st: str(c.st), zip: str(c.zip), source: str(c.source),
    tags: str(c.tags), marketing: !!c.marketing, notes: str(c.notes),
    created_at: iso(c.createdAt) || new Date().toISOString(), legacy_id: c.id,
  }));
  const contactIds = new Set((s.contacts || []).filter(c => keep(c) || usedContacts.has(c.id)).map(c => c.id));

  const jobs = [];
  const job_activity = [];
  for (const j of srcJobs) {
    let stage = j.stageId;
    if (!STAGES.includes(stage)) {
      warnings.push(`Job ${j.number} had an unknown stage "${stage}" and was set to New Lead.`);
      stage = 'lead';
    }
    const id = nid(j.id);
    jobs.push({
      id, number: Math.trunc(num(j.number)), name: str(j.name) || `Job ${j.number}`,
      contact_id: contactIds.has(j.contactId) ? nid(j.contactId) : null, stage,
      stage_changed_at: iso(j.stageChangedAt) || new Date().toISOString(),
      type: j.type === 'Insurance' ? 'Insurance' : 'Retail', roof_type: str(j.roofType), squares: num(j.squares),
      pitch: str(j.pitch), rep_id: profileIds.get(j.repId) || null, crew_id: null, value: num(j.value),
      sold_at: iso(j.soldAt), lost_reason: str(j.lostReason), insurance: j.insurance || {},
      created_at: iso(j.createdAt) || new Date().toISOString(), legacy_id: j.id,
    });
    for (const a of j.activity || []) {
      job_activity.push({ job_id: id, at: iso(a.at) || new Date().toISOString(), kind: str(a.kind) || 'system', text: str(a.text), user_id: null });
    }
    job_activity.push({ job_id: id, at: new Date().toISOString(), kind: 'system', text: 'Imported from the prototype', user_id: null });
  }

  // ---- estimates, invoices, payments (estimates first so invoices can point at them)
  const srcDocs = (s.documents || []).filter(d => jobIds.has(d.jobId))
    .sort((a, b) => (a.fromId ? 1 : 0) - (b.fromId ? 1 : 0));
  const docIds = new Set(srcDocs.map(d => d.id));
  const documents = [];
  const payments = [];
  for (const d of srcDocs) {
    let status = d.status;
    if (!DOC_STATUSES.includes(status)) {
      warnings.push(`Document ${d.kind} ${d.number} had status "${status}" and was imported as a draft.`);
      status = 'draft';
    }
    const id = nid(d.id);
    documents.push({
      id, kind: d.kind === 'invoice' ? 'invoice' : 'estimate', number: Math.trunc(num(d.number)), job_id: nid(d.jobId),
      status, date: dateOrNull(d.date) || new Date().toISOString().slice(0, 10), due_date: dateOrNull(d.dueDate),
      items: (d.items || []).map(l => ({ desc: str(l.desc), qty: num(l.qty), unit: str(l.unit), price: num(l.price) })),
      tax_rate: num(d.taxRate), notes: str(d.notes), from_id: docIds.has(d.fromId) ? nid(d.fromId) : null, legacy_id: d.id,
    });
    for (const p of d.payments || []) {
      if (!(num(p.amount) > 0)) { warnings.push(`Skipped a zero payment on ${d.kind} ${d.number}.`); continue; }
      payments.push({ document_id: id, date: dateOrNull(p.date) || new Date().toISOString().slice(0, 10), amount: num(p.amount), method: str(p.method), note: str(p.note), legacy_id: p.id || randomUUID() });
    }
  }

  // ---- tasks and calendar
  const inScope = x => keep(x) && (!x.jobId || jobIds.has(x.jobId));
  const tasks = (s.tasks || []).filter(inScope).map(t => {
    if (t.assigneeId && crewIds.has(t.assigneeId)) warnings.push(`Task "${t.title}" was assigned to ${crewNamed.get(t.assigneeId)}; tasks are for staff now, so it is unassigned.`);
    return { id: nid(t.id), title: str(t.title) || 'Task', job_id: nid(t.jobId), assignee_id: profileIds.get(t.assigneeId) || null, due: dateOrNull(t.due), done: !!t.done, legacy_id: t.id };
  });
  const events = (s.events || []).filter(inScope).map(e => ({
    id: nid(e.id), title: str(e.title) || 'Event', type: str(e.type) || 'Other', job_id: nid(e.jobId),
    assignee_id: profileIds.get(e.assigneeId) || null, crew_id: crewIds.get(e.assigneeId) || null,
    date: dateOrNull(e.date) || new Date().toISOString().slice(0, 10), time: str(e.time), notes: str(e.notes), legacy_id: e.id,
  }));

  // ---- email setup and history
  const templates = (s.templates || []).map(t => ({
    id: nid(t.id), key: t.id, name: str(t.name) || 'Template', kind: t.kind === 'marketing' ? 'marketing' : 'followup',
    subject: str(t.subject), body: str(t.body),
  }));
  const templateIds = new Set((s.templates || []).map(t => t.id));
  const automation_rules = (s.rules || []).filter(r => templateIds.has(r.templateId) && STAGES.includes(r.stageId)).map(r => ({
    id: nid(r.id), name: str(r.name) || 'Rule', stage: r.stageId, delay_days: Math.max(0, Math.trunc(num(r.delayDays))),
    template_id: nid(r.templateId), stop_on_exit: !!r.stopOnExit, active: r.active !== false,
  }));
  const ruleIds = new Set((s.rules || []).map(r => r.id));
  const campaigns = (s.campaigns || []).filter(keep).map(c => ({
    id: nid(c.id), name: str(c.name) || 'Campaign', template_id: templateIds.has(c.templateId) ? nid(c.templateId) : null,
    audience_label: str(c.audienceLabel), recipient_count: Math.trunc(num(c.count)), created_at: iso(c.createdAt) || new Date().toISOString(),
  }));
  const campaignIds = new Set((s.campaigns || []).filter(keep).map(c => c.id));
  const outbox = (s.outbox || []).filter(o => inScope(o) && contactIds.has(o.contactId)).map(o => ({
    rule_id: ruleIds.has(o.ruleId) ? nid(o.ruleId) : null, campaign_id: campaignIds.has(o.campaignId) ? nid(o.campaignId) : null,
    template_id: templateIds.has(o.templateId) ? nid(o.templateId) : null, job_id: nid(o.jobId), contact_id: nid(o.contactId),
    to_email: str(o.to), subject: str(o.subject), body: str(o.body), kind: o.kind === 'marketing' ? 'marketing' : 'followup',
    send_at: iso(o.sendAt) || new Date().toISOString(), status: OUTBOX_STATUSES.includes(o.status) ? o.status : 'cancelled',
    reason: str(o.reason), sent_at: o.status === 'sent' ? iso(o.sentAt || o.sendAt) : null,
  }));

  const catalog_items = (s.catalog || []).map((c, i) => ({ name: str(c.desc) || 'Item', description: '', unit: str(c.unit) || 'EA', price: num(c.price), sort: i + 1 }));
  const st = s.settings || {};
  const settings = {
    company: str(st.company) || 'Your Roofing Company', phone: str(st.phone), email: str(st.email), address: str(st.address),
    license: str(st.license), tax_rate: num(st.taxRate), review_url: str(st.reviewUrl), terms: str(st.terms),
  };

  const photos = (backup.photos || []).filter(p => jobIds.has(p.jobId) && /^data:image\//.test(str(p.data))).map(p => {
    const id = randomUUID();
    const jobId = nid(p.jobId);
    return {
      row: { id, job_id: jobId, storage_path: `${jobId}/${id}.jpg`, category: str(p.category) || 'Before', caption: str(p.caption), uploaded_by: null, taken_at: iso(p.at) || new Date().toISOString(), legacy_id: p.id },
      dataUrl: p.data,
    };
  });

  return {
    settings,
    tables: { crews, contacts, jobs, job_activity, documents, payments, tasks, events, templates, automation_rules, campaigns, outbox, catalog_items },
    photos,
    warnings: [...new Set(warnings)],
  };
}

/** Tables the import replaces outright (they come pre-filled with starter content). */
export const REPLACED_TABLES = ['automation_rules', 'templates', 'catalog_items'];

/** Insert order that satisfies foreign keys. */
export const INSERT_ORDER = ['crews', 'contacts', 'jobs', 'job_activity', 'documents', 'payments', 'tasks', 'events', 'templates', 'automation_rules', 'campaigns', 'outbox', 'catalog_items'];

export function dataUrlToBuffer(dataUrl) {
  const [head, b64] = dataUrl.split(',', 2);
  return { buffer: Buffer.from(b64, 'base64'), contentType: (head.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg' };
}

/**
 * Writes a transformed backup through a writer:
 * { countImportedJobs(), deleteAll(table), insert(table, rows), updateSettings(row), upload(path, buffer, type), syncSequences() }
 */
export async function runImport(result, writer, log = () => {}) {
  if (await writer.countImportedJobs() > 0) {
    throw new Error('This database already has imported jobs. The import is meant to run once, on a fresh database.');
  }
  for (const t of REPLACED_TABLES) await writer.deleteAll(t);
  await writer.updateSettings(result.settings);
  for (const t of INSERT_ORDER) {
    const rows = result.tables[t];
    for (let i = 0; i < rows.length; i += 500) await writer.insert(t, rows.slice(i, i + 500));
    log(`${t}: ${rows.length}`);
  }
  let uploaded = 0;
  for (const p of result.photos) {
    const { buffer, contentType } = dataUrlToBuffer(p.dataUrl);
    await writer.upload(p.row.storage_path, buffer, contentType);
    await writer.insert('photos', [p.row]);
    uploaded++;
  }
  log(`photos: ${uploaded}`);
  await writer.syncSequences();
}
