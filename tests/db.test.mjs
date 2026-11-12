// Permission and business-rule tests for the Supabase migrations.
// Run with: npm run test:db
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, as, asAnon, one, all } from './helpers/db.mjs';

let db;
const u = {};
const ids = {};

before(async () => {
  db = await createTestDb();
  u.owner = await createUser(db, 'owner@example.com', 'Olivia Owner');
  u.office = await createUser(db, 'office@example.com', 'Oscar Office');
  u.rep1 = await createUser(db, 'rep1@example.com', 'Rita Rep');
  u.rep2 = await createUser(db, 'rep2@example.com', 'Ray Rep');
  u.crewA = await createUser(db, 'crewa@example.com', 'Alex Crew Lead');
  u.crewB = await createUser(db, 'crewb@example.com', 'Blair Crew Lead');
  u.stranger = await createUser(db, 'stranger@example.com', 'Not Invited');

  await as(db, u.owner, async q => {
    ids.crewA = (await one(q, `insert into crews (name) values ('Crew A') returning id`)).id;
    ids.crewB = (await one(q, `insert into crews (name) values ('Crew B') returning id`)).id;
    await q.query(`update profiles set role = 'office', active = true where id = $1`, [u.office]);
    await q.query(`update profiles set role = 'rep', active = true where id in ($1, $2)`, [u.rep1, u.rep2]);
    await q.query(`update profiles set role = 'crew', crew_id = $2, active = true where id = $1`, [u.crewA, ids.crewA]);
    await q.query(`update profiles set role = 'crew', crew_id = $2, active = true where id = $1`, [u.crewB, ids.crewB]);
  });
});

test('first account becomes the active owner; later sign-ups start inactive', async () => {
  const owner = await one(db, `select role, active from profiles where id = $1`, [u.owner]);
  assert.deepEqual(owner, { role: 'owner', active: true });
  const stranger = await one(db, `select role, active from profiles where id = $1`, [u.stranger]);
  assert.equal(stranger.active, false);
});

test('a crew profile must be tied to a crew', async () => {
  await assert.rejects(
    as(db, u.owner, q => q.query(`update profiles set role = 'crew', crew_id = null, active = true where id = $1`, [u.rep2])),
    /crew_role_needs_crew/,
  );
});

test('reps cannot change roles or company settings', async () => {
  await as(db, u.rep1, async q => {
    const r = await q.query(`update profiles set role = 'owner' where id = $1`, [u.rep1]);
    assert.equal(r.affectedRows, 0);
    const s = await q.query(`update settings set company = 'Hacked'`);
    assert.equal(s.affectedRows, 0);
  });
  assert.equal((await one(db, `select role from profiles where id = $1`, [u.rep1])).role, 'rep');
});

test('office cannot create or change owners; nobody can lock themselves out', async () => {
  await assert.rejects(
    as(db, u.office, q => q.query(`update profiles set role = 'owner' where id = $1`, [u.office])),
    /cannot change your own role/,
  );
  await assert.rejects(
    as(db, u.office, q => q.query(`update profiles set role = 'owner' where id = $1`, [u.rep2])),
    /Only an owner/,
  );
  await assert.rejects(
    as(db, u.office, q => q.query(`update profiles set active = false where id = $1`, [u.owner])),
    /Only an owner/,
  );
  await assert.rejects(
    as(db, u.owner, q => q.query(`update profiles set active = false where id = $1`, [u.owner])),
    /turn off your own access/,
  );
  // Office can still manage reps and crews.
  await as(db, u.office, q => q.query(`update profiles set phone = '(555) 555-0123' where id = $1`, [u.rep2]));
  assert.equal((await one(db, `select phone from profiles where id = $1`, [u.rep2])).phone, '(555) 555-0123');
});

test('new job queues the welcome email; marketing rules respect opt-in', async () => {
  await as(db, u.rep1, async q => {
    ids.contact = (await one(q, `insert into contacts (first, last, email, phone, address, city, st, zip, marketing)
      values ('Avery', 'Thompson', 'avery@example.com', '(555) 555-0110', '1420 Maplewood Dr', 'Springfield', 'MO', '65801', false) returning id`)).id;
    const job = await one(q, `insert into jobs (name, contact_id, rep_id, type, roof_type, squares, pitch)
      values ('Thompson Re-roof', $1, $2, 'Retail', 'Asphalt shingle', 28, '6/12') returning id, number, stage`, [ids.contact, u.rep1]);
    ids.job = job.id;
    assert.equal(job.number, 1001);
    assert.equal(job.stage, 'lead');
  });
  const mail = await all(db, `select subject, status from outbox where job_id = $1`, [ids.job]);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].status, 'scheduled');
  assert.match(mail[0].subject, /Thanks for contacting/);

  // A marketing rule on 'inspected' must be skipped for a contact who has not opted in.
  await as(db, u.owner, q => q.query(`insert into automation_rules (name, stage, template_id)
    select 'Storm offer', 'inspected', id from templates where key = 't_storm'`));
  await as(db, u.rep1, q => q.query(`update jobs set stage = 'inspected' where id = $1`, [ids.job]));
  const storm = await one(db, `select o.status, o.reason from outbox o join templates t on t.id = o.template_id
    where o.job_id = $1 and t.key = 't_storm'`, [ids.job]);
  assert.deepEqual(storm, { status: 'skipped', reason: 'Contact has not opted in to marketing' });
});

test('leaving a stage cancels its stop-on-exit follow-ups and logs the move', async () => {
  await as(db, u.rep1, q => q.query(`update jobs set stage = 'estimate' where id = $1`, [ids.job]));
  let est = await all(db, `select status from outbox o join automation_rules r on r.id = o.rule_id
    where o.job_id = $1 and r.stage = 'estimate'`, [ids.job]);
  assert.deepEqual(est.map(x => x.status), ['scheduled', 'scheduled']);

  await as(db, u.rep1, q => q.query(`update jobs set stage = 'sold' where id = $1`, [ids.job]));
  est = await all(db, `select status, reason from outbox o join automation_rules r on r.id = o.rule_id
    where o.job_id = $1 and r.stage = 'estimate'`, [ids.job]);
  assert.ok(est.every(x => x.status === 'cancelled' && x.reason === 'Job left Estimate Sent'));

  const job = await one(db, `select sold_at, stage_changed_at from jobs where id = $1`, [ids.job]);
  assert.ok(job.sold_at, 'sold_at set when the job reaches Sold');
  const log = await all(db, `select text from job_activity where job_id = $1 order by at`, [ids.job]);
  assert.ok(log.some(l => l.text === 'Moved from Estimate Sent to Sold'));
});

test('reps see every job, including other reps\' jobs, but cannot delete jobs', async () => {
  await as(db, u.rep2, async q => {
    const jobs = await all(q, `select id from jobs`);
    assert.equal(jobs.length, 1);
    const del = await q.query(`delete from jobs where id = $1`, [ids.job]);
    assert.equal(del.affectedRows, 0);
  });
  assert.ok(await one(db, `select 1 as ok from jobs where id = $1`, [ids.job]));
});

test('estimate numbering, accepted estimate and price-free work order', async () => {
  await as(db, u.office, async q => {
    const d = await one(q, `insert into documents (kind, job_id, status, items, tax_rate)
      values ('estimate', $1, 'accepted', $2, 7.5) returning id, number`, [ids.job, JSON.stringify([
      { desc: 'Tear-off existing roofing', qty: 28, unit: 'SQ', price: 65 },
      { desc: 'Architectural shingles, installed', qty: 28, unit: 'SQ', price: 340 },
    ])]);
    ids.estimate = d.id;
    assert.equal(d.number, 1);
    ids.woA = (await one(q, `select create_work_order($1, $2, current_date + 3) as id`, [ids.job, ids.crewA])).id;
  });
  const wo = await one(db, `select scope, customer_name, site_address, job_number from work_orders where id = $1`, [ids.woA]);
  assert.equal(wo.customer_name, 'Avery Thompson');
  assert.equal(wo.site_address, '1420 Maplewood Dr, Springfield, MO 65801');
  assert.equal(wo.job_number, 1001);
  assert.equal(wo.scope.length, 2);
  assert.ok(wo.scope.every(i => !('price' in i)), 'no prices copied into the scope');
  assert.deepEqual(wo.scope[0], { desc: 'Tear-off existing roofing', qty: 28, unit: 'SQ' });
});

test('a work order can never hold prices', async () => {
  await assert.rejects(
    as(db, u.office, q => q.query(`insert into work_orders (job_id, crew_id, job_number, scope) values ($1, $2, 1001, $3)`,
      [ids.job, ids.crewA, JSON.stringify([{ desc: 'Shingles', qty: 1, unit: 'SQ', price: 340 }])])),
    /scope_has_no_prices/,
  );
});

test('crews cannot read jobs, customers, money, settings or other crews\' work', async () => {
  await as(db, u.crewA, async q => {
    for (const t of ['jobs', 'contacts', 'documents', 'payments', 'settings', 'catalog_items', 'outbox', 'templates', 'job_activity', 'tasks']) {
      const rows = await all(q, `select * from ${t}`);
      assert.equal(rows.length, 0, `crew should see no rows in ${t}`);
    }
    const profiles = await all(q, `select id from profiles`);
    assert.deepEqual(profiles.map(p => p.id), [u.crewA]);
    const wos = await all(q, `select id from work_orders`);
    assert.deepEqual(wos.map(w => w.id), [ids.woA]);
  });
  await as(db, u.crewB, async q => {
    assert.equal((await all(q, `select id from work_orders`)).length, 0);
    const r = await q.query(`update work_orders set status = 'done' where id = $1`, [ids.woA]);
    assert.equal(r.affectedRows, 0, 'Crew B cannot touch Crew A\'s work order');
  });
});

test('crews may change only status and notes; it advances the job', async () => {
  await assert.rejects(
    as(db, u.crewA, q => q.query(`update work_orders set customer_name = 'X' where id = $1`, [ids.woA])),
    /Crews can only change/,
  );
  await assert.rejects(
    as(db, u.crewA, q => q.query(`update work_orders set crew_id = $2 where id = $1`, [ids.woA, ids.crewB])),
  );
  await as(db, u.crewA, q => q.query(`update work_orders set status = 'in_progress', crew_notes = 'Gate code 4411' where id = $1`, [ids.woA]));
  assert.equal((await one(db, `select stage from jobs where id = $1`, [ids.job])).stage, 'progress');

  await as(db, u.crewA, q => q.query(`update work_orders set status = 'done', completed_at = '2000-01-01' where id = $1`, [ids.woA]));
  const wo = await one(db, `select status, started_at, completed_at from work_orders where id = $1`, [ids.woA]);
  assert.equal(wo.status, 'done');
  assert.ok(wo.started_at && wo.completed_at.getFullYear() > 2000, 'crew cannot backdate timestamps');
  assert.equal((await one(db, `select stage from jobs where id = $1`, [ids.job])).stage, 'complete');
  const review = await one(db, `select o.status from outbox o join templates t on t.id = o.template_id
    where o.job_id = $1 and t.key = 't_review'`, [ids.job]);
  assert.equal(review.status, 'scheduled', 'review request queued when the crew finishes');
});

test('invoice payments: overpayment blocked, full payment marks the job paid', async () => {
  await as(db, u.office, async q => {
    ids.invoice = (await one(q, `insert into documents (kind, job_id, status, items, tax_rate, from_id)
      select 'invoice', job_id, 'sent', items, tax_rate, id from documents where id = $1 returning id, number`, [ids.estimate])).id;
  });
  assert.equal((await one(db, `select stage from jobs where id = $1`, [ids.job])).stage, 'invoiced');
  // (28*65 + 28*340) = 11340, +7.5% tax 850.50 = 12190.50
  await assert.rejects(
    as(db, u.office, q => q.query(`insert into payments (document_id, amount) values ($1, 12190.51)`, [ids.invoice])),
    /more than the balance/,
  );
  await as(db, u.office, q => q.query(`insert into payments (document_id, amount) values ($1, 6000)`, [ids.invoice]));
  assert.equal((await one(db, `select stage from jobs where id = $1`, [ids.job])).stage, 'invoiced');
  await as(db, u.office, q => q.query(`insert into payments (document_id, amount) values ($1, 6190.50)`, [ids.invoice]));
  assert.equal((await one(db, `select stage from jobs where id = $1`, [ids.job])).stage, 'paid');
});

test('auto stage changes only move forward and never reopen a lost job', async () => {
  let lostJob;
  await as(db, u.rep1, async q => {
    lostJob = (await one(q, `insert into jobs (name, contact_id, stage) values ('Lost one', $1, 'lost') returning id`, [ids.contact])).id;
    await q.query(`insert into events (title, type, job_id, date) values ('Install', 'Install', $1, current_date)`, [lostJob]);
  });
  assert.equal((await one(db, `select stage from jobs where id = $1`, [lostJob])).stage, 'lost');
  await as(db, u.rep1, q => q.query(`insert into events (title, type, job_id, date) values ('Inspection', 'Inspection', $1, current_date)`, [ids.job]));
  assert.equal((await one(db, `select stage from jobs where id = $1`, [ids.job])).stage, 'paid', 'paid job not pulled back');
});

test('photos and storage: crews see and upload only on their own jobs', async () => {
  let otherJob;
  await as(db, u.office, async q => {
    otherJob = (await one(q, `insert into jobs (name) values ('Other job') returning id`)).id;
    await q.query(`insert into photos (job_id, storage_path) values ($1, $2), ($3, $4)`,
      [ids.job, `${ids.job}/a.jpg`, otherJob, `${otherJob}/b.jpg`]);
    await q.query(`insert into storage.objects (bucket_id, name) values ('job-photos', $1), ('job-photos', $2)`,
      [`${ids.job}/a.jpg`, `${otherJob}/b.jpg`]);
  });
  await as(db, u.crewA, async q => {
    assert.deepEqual((await all(q, `select storage_path from photos`)).map(p => p.storage_path), [`${ids.job}/a.jpg`]);
    assert.deepEqual((await all(q, `select name from storage.objects`)).map(o => o.name), [`${ids.job}/a.jpg`]);
    await q.query(`insert into photos (job_id, storage_path, uploaded_by) values ($1, $2, $3)`, [ids.job, `${ids.job}/c.jpg`, u.crewA]);
    await q.query(`insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${ids.job}/c.jpg`]);
  });
  await assert.rejects(as(db, u.crewA, q => q.query(`insert into photos (job_id, storage_path, uploaded_by) values ($1, 'x.jpg', $2)`, [otherJob, u.crewA])));
  await assert.rejects(as(db, u.crewA, q => q.query(`insert into storage.objects (bucket_id, name) values ('job-photos', $1)`, [`${otherJob}/evil.jpg`])));
  await assert.rejects(as(db, u.crewA, q => q.query(`insert into storage.objects (bucket_id, name) values ('job-photos', 'not-a-uuid/x.jpg')`)));
  await as(db, u.crewB, async q => {
    assert.equal((await all(q, `select id from photos`)).length, 0);
    assert.equal((await all(q, `select id from storage.objects`)).length, 0);
  });
});

test('photo files: crews delete only files they uploaded; bucket only takes images', async () => {
  const bucket = await one(db, `select file_size_limit, allowed_mime_types from storage.buckets where id = 'job-photos'`);
  assert.equal(Number(bucket.file_size_limit), 10485760);
  assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  // Crew A uploaded c.jpg in the previous test; a.jpg was uploaded by the office.
  await as(db, u.crewA, async q => {
    const mine = await q.query(`delete from storage.objects where name = $1`, [`${ids.job}/c.jpg`]);
    assert.equal(mine.affectedRows, 1);
    const theirs = await q.query(`delete from storage.objects where name = $1`, [`${ids.job}/a.jpg`]);
    assert.equal(theirs.affectedRows, 0, 'crew cannot delete office photos');
  });
  await as(db, u.crewB, async q => {
    assert.equal((await q.query(`delete from storage.objects where bucket_id = 'job-photos'`)).affectedRows, 0);
  });
});

test('signed-out visitors and uninvited accounts see nothing', async () => {
  await asAnon(db, async q => {
    for (const t of ['jobs', 'contacts', 'profiles', 'work_orders', 'settings']) {
      assert.equal((await all(q, `select * from ${t}`)).length, 0, `anon sees no ${t}`);
    }
  });
  await as(db, u.stranger, async q => {
    for (const t of ['jobs', 'contacts', 'work_orders', 'settings', 'crews']) {
      assert.equal((await all(q, `select * from ${t}`)).length, 0, `inactive account sees no ${t}`);
    }
    assert.equal((await all(q, `select id from profiles`)).length, 1, 'only their own profile');
  });
});

test('job list view: staff see value from the accepted estimate; crews see nothing', async () => {
  await as(db, u.rep2, async q => {
    const row = await one(q, `select customer_name, rep_name, amount from job_list where id = $1`, [ids.job]);
    assert.equal(row.customer_name, 'Avery Thompson');
    assert.equal(row.rep_name, 'Rita Rep');
    assert.equal(Number(row.amount), 12190.5);
  });
  await as(db, u.crewA, async q => {
    assert.equal((await all(q, `select id from job_list`)).length, 0);
  });
});

test('anyone can edit their own name and phone, but not their role', async () => {
  await as(db, u.crewA, q => q.query(`select update_my_profile('Alex Martinez', '(555) 555-0177')`));
  const p = await one(db, `select full_name, phone, role from profiles where id = $1`, [u.crewA]);
  assert.deepEqual(p, { full_name: 'Alex Martinez', phone: '(555) 555-0177', role: 'crew' });
  await assert.rejects(asAnon(db, q => q.query(`select update_my_profile('x', 'y')`)), /permission denied/);
});

test('share link and e-sign: customer signs, job moves to Sold, signed estimate is locked', async () => {
  let job, est, token;
  await as(db, u.rep1, async q => {
    job = (await one(q, `insert into jobs (name, contact_id) values ('Sign test', $1) returning id`, [ids.contact])).id;
    est = (await one(q, `insert into documents (kind, job_id, items, tax_rate) values ('estimate', $1, $2, 0) returning id`,
      [job, JSON.stringify([{ desc: 'Shingles', qty: 10, unit: 'SQ', price: 300 }])])).id;
    token = (await one(q, `select share_document($1) as t`, [est])).t;
  });
  assert.equal(token.length, 64);
  assert.equal((await one(db, `select status from documents where id = $1`, [est])).status, 'sent');
  assert.equal((await one(db, `select stage from jobs where id = $1`, [job])).stage, 'estimate', 'sending the estimate moved the job');

  // Signed-out customer: can read the shared document only through the token.
  const doc = await asAnon(db, async q => {
    assert.equal((await all(q, `select id from documents`)).length, 0, 'tables stay closed to the public');
    assert.equal((await one(q, `select get_shared_document('nope') as d`)).d, null);
    assert.equal((await one(q, `select get_shared_document($1) as d`, ['x'.repeat(64)])).d, null);
    return (await one(q, `select get_shared_document($1) as d`, [token])).d;
  });
  assert.equal(doc.kind, 'estimate');
  assert.equal(Number(doc.total), 3000);
  assert.equal(doc.customer.first, 'Avery');
  assert.equal(doc.company.company, 'Your Roofing Company');
  assert.ok(!('share_token' in doc) && !('signed_ip' in doc), 'no internal fields leak');
  assert.ok((await one(db, `select viewed_at from documents where id = $1`, [est])).viewed_at, 'first view recorded');
  await db.query(`update documents set viewed_at = null where id = $1`, [est]);
  await as(db, u.rep1, q => q.query(`select get_shared_document($1, false)`, [token]));
  assert.equal((await one(db, `select viewed_at from documents where id = $1`, [est])).viewed_at, null, 'staff preview not counted');

  await assert.rejects(asAnon(db, q => q.query(`select sign_document($1, 'A', null)`, [token])), /full name/);
  await assert.rejects(asAnon(db, q => q.query(`select sign_document($1, 'Avery Thompson', 'javascript:alert(1)')`, [token])), /could not be read/);
  await asAnon(db, q => q.query(`select sign_document($1, 'Avery Thompson', 'data:image/png;base64,iVBORw0KGgo=', '203.0.113.9')`, [token]));

  const signed = await one(db, `select status, signed_name, signed_ip, signed_at from documents where id = $1`, [est]);
  assert.equal(signed.status, 'accepted');
  assert.equal(signed.signed_name, 'Avery Thompson');
  assert.equal(signed.signed_ip, '203.0.113.9');
  assert.equal((await one(db, `select stage from jobs where id = $1`, [job])).stage, 'sold');
  assert.ok((await all(db, `select text from job_activity where job_id = $1`, [job])).some(a => /signed online by Avery Thompson/.test(a.text)));

  await assert.rejects(asAnon(db, q => q.query(`select sign_document($1, 'Someone Else', null)`, [token])), /already been signed/);
  await assert.rejects(
    as(db, u.office, q => q.query(`update documents set items = '[]' where id = $1`, [est])),
    /signed by the customer/,
  );
  // Notes can still be updated on a signed estimate.
  await as(db, u.office, q => q.query(`update documents set notes = 'Install in spring' where id = $1`, [est]));
});

test('invoices can be shared for viewing but not signed', async () => {
  let token;
  await as(db, u.office, async q => {
    token = (await one(q, `select share_document($1) as t`, [ids.invoice])).t;
  });
  const doc = await asAnon(db, async q => (await one(q, `select get_shared_document($1) as d`, [token])).d);
  assert.equal(doc.kind, 'invoice');
  assert.equal(Number(doc.paid), 12190.5);
  await assert.rejects(asAnon(db, q => q.query(`select sign_document($1, 'Avery Thompson', null)`, [token])), /Only estimates/);
  await assert.rejects(asAnon(db, q => q.query(`select share_document($1)`, [ids.invoice])), /permission denied/);
});

test('email queue: claim hands out due emails once, recovers stuck ones, and is service-only', async () => {
  await db.query(`delete from outbox`);
  await db.query(`insert into outbox (contact_id, to_email, subject, body, send_at, status) values
    ($1, 'a@example.com', 'due 1', 'x', now() - interval '1 hour', 'scheduled'),
    ($1, 'a@example.com', 'due 2', 'x', now() - interval '1 minute', 'scheduled'),
    ($1, 'a@example.com', 'later', 'x', now() + interval '1 day', 'scheduled'),
    ($1, 'a@example.com', 'cancelled', 'x', now() - interval '1 hour', 'cancelled'),
    ($1, 'a@example.com', 'stuck', 'x', now() - interval '2 hours', 'sending')`, [ids.contact]);
  await db.query(`update outbox set claimed_at = now() - interval '1 hour', attempts = 1 where subject = 'stuck'`);

  await db.query(`set role service_role`);
  const first = await all(db, `select subject, status, attempts from claim_outbox(10) order by send_at`);
  const second = await all(db, `select subject from claim_outbox(10)`);
  await db.query(`reset role`);

  assert.deepEqual(first.map(r => r.subject), ['stuck', 'due 1', 'due 2']);
  assert.ok(first.every(r => r.status === 'sending'));
  assert.equal(first[0].attempts, 2, 'stuck email retried with attempt counted');
  assert.equal(second.length, 0, 'nothing handed out twice');
  await assert.rejects(as(db, u.owner, q => q.query(`select * from claim_outbox(10)`)), /permission denied/);
  await assert.rejects(asAnon(db, q => q.query(`select * from claim_outbox(10)`)), /permission denied/);
});

test('unsubscribe link: stops marketing, cancels queued marketing, keeps job follow-ups', async () => {
  const { unsubscribe_token: token } = await one(db, `update contacts set marketing = true, unsubscribed_at = null where id = $1 returning unsubscribe_token`, [ids.contact]);
  assert.equal(token.length, 64);
  await db.query(`delete from outbox`);
  await db.query(`insert into outbox (contact_id, to_email, subject, body, kind, status) values
    ($1, 'a@example.com', 'Storm offer', 'x', 'marketing', 'scheduled'),
    ($1, 'a@example.com', 'Install prep', 'x', 'followup', 'scheduled')`, [ids.contact]);

  const info = await asAnon(db, async q => (await one(q, `select unsubscribe_info($1) as i`, [token])).i);
  assert.equal(info.company, 'Your Roofing Company');
  assert.equal(info.email, 'a•••@example.com');
  assert.equal(info.unsubscribed, false);
  assert.equal(await asAnon(db, async q => (await one(q, `select unsubscribe_info('nope') as i`)).i), null);

  assert.equal(await asAnon(db, async q => (await one(q, `select unsubscribe_contact($1) as ok`, [token])).ok), true);
  const c = await one(db, `select marketing, unsubscribed_at from contacts where id = $1`, [ids.contact]);
  assert.equal(c.marketing, false);
  assert.ok(c.unsubscribed_at);
  const mail = await all(db, `select subject, status from outbox order by subject`);
  assert.deepEqual(mail, [{ subject: 'Install prep', status: 'scheduled' }, { subject: 'Storm offer', status: 'cancelled' }]);
  assert.equal(await asAnon(db, async q => (await one(q, `select unsubscribe_contact('x') as ok`)).ok), false);
});

test('importer helper is not callable by signed-in users', async () => {
  await assert.rejects(as(db, u.owner, q => q.query(`select sync_number_sequences()`)), /permission denied/);
});

test('plan usage numbers: admins only', async () => {
  const usage = await as(db, u.office, q => one(q, `select public.plan_usage() as u`));
  assert.ok(Number(usage.u.db_bytes) > 0);
  assert.equal(typeof usage.u.emails_month, 'number');
  await assert.rejects(as(db, u.rep1, q => q.query(`select public.plan_usage()`)), /not allowed/);
  await assert.rejects(as(db, u.crewA, q => q.query(`select public.plan_usage()`)), /not allowed/);
  await assert.rejects(asAnon(db, q => q.query(`select public.plan_usage()`)), /permission denied/);
});
