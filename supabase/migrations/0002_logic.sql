-- Business rules that must hold no matter which screen or phone makes the change:
-- stage bookkeeping, automatic follow-up emails, forward-only auto stage changes,
-- work orders and the limits on what a crew can edit.
-- Rows that carry a legacy_id came from the prototype import and skip the side effects.

create function private.stage_rank(s text) returns int
language sql immutable set search_path = '' as $$
  select array_position(array['lead', 'insp', 'inspected', 'estimate', 'claim', 'sold', 'materials',
    'scheduled', 'progress', 'complete', 'invoiced', 'paid', 'lost'], s)
$$;

create function private.stage_name(s text) returns text
language sql immutable set search_path = '' as $$
  select case s
    when 'lead' then 'New Lead' when 'insp' then 'Inspection Set' when 'inspected' then 'Inspected'
    when 'estimate' then 'Estimate Sent' when 'claim' then 'Claim In Review' when 'sold' then 'Sold'
    when 'materials' then 'Materials Ordered' when 'scheduled' then 'Install Scheduled'
    when 'progress' then 'In Progress' when 'complete' then 'Completed' when 'invoiced' then 'Invoiced'
    when 'paid' then 'Paid' when 'lost' then 'Lost' else s end
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger contacts_touch before update on public.contacts for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- job stages and automations
create function private.jobs_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  end if;
  if new.sold_at is null and new.stage <> 'lost'
     and private.stage_rank(new.stage) >= private.stage_rank('sold') then
    new.sold_at := now();
  end if;
  return new;
end $$;
create trigger jobs_before_write before insert or update on public.jobs
for each row execute function private.jobs_before_write();

create function private.jobs_after_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.contacts;
  r record;
  no_email boolean;
  no_optin boolean;
begin
  if tg_op = 'INSERT' and new.legacy_id is not null then return null; end if;
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return null; end if;

  if tg_op = 'UPDATE' then
    insert into public.job_activity (job_id, kind, text)
    values (new.id, 'stage', format('Moved from %s to %s', private.stage_name(old.stage), private.stage_name(new.stage)));

    update public.outbox o
       set status = 'cancelled', reason = format('Job left %s', private.stage_name(old.stage))
      from public.automation_rules ar
     where o.job_id = new.id and o.status = 'scheduled' and o.rule_id = ar.id
       and ar.stop_on_exit and ar.stage = old.stage;
  end if;

  select * into c from public.contacts where id = new.contact_id;
  if c.id is null then return null; end if;

  for r in
    select ar.id as rule_id, ar.delay_days, t.id as template_id, t.subject, t.body, t.kind
      from public.automation_rules ar join public.templates t on t.id = ar.template_id
     where ar.active and ar.stage = new.stage
  loop
    continue when exists (
      select 1 from public.outbox
       where job_id = new.id and rule_id = r.rule_id and status in ('scheduled', 'sending', 'sent'));
    no_email := c.email = '';
    no_optin := r.kind = 'marketing' and (not c.marketing or c.unsubscribed_at is not null);
    insert into public.outbox (rule_id, template_id, job_id, contact_id, to_email, subject, body, kind, send_at, status, reason)
    values (r.rule_id, r.template_id, new.id, c.id, c.email, r.subject, r.body, r.kind,
            now() + make_interval(days => r.delay_days),
            case when no_email or no_optin then 'skipped' else 'scheduled' end,
            case when no_email then 'No email address on contact'
                 when no_optin then 'Contact has not opted in to marketing' else '' end);
  end loop;
  return null;
end $$;
create trigger jobs_after_stage after insert or update of stage on public.jobs
for each row execute function private.jobs_after_stage();

-- Moves a job forward only, and never reopens a lost job.
create function private.advance_job(p_job uuid, p_stage text) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set stage = p_stage
   where id = p_job and stage <> 'lost' and private.stage_rank(stage) < private.stage_rank(p_stage)
$$;

-- ---------------------------------------------------------------- money
create function private.document_total(p_items jsonb, p_tax numeric) returns numeric
language sql immutable set search_path = '' as $$
  with sub as (
    select coalesce(sum(round(coalesce(nullif(i ->> 'qty', '')::numeric, 0)
                            * coalesce(nullif(i ->> 'price', '')::numeric, 0), 2)), 0) as s
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i)
  select round(s + round(s * coalesce(p_tax, 0) / 100, 2), 2) from sub
$$;

create function private.document_balance(p_doc uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select private.document_total(d.items, d.tax_rate)
         - coalesce((select sum(amount) from public.payments where document_id = d.id), 0)
    from public.documents d where d.id = p_doc
$$;

create function private.documents_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.legacy_id is not null then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  if new.kind = 'estimate' and new.status = 'sent' then perform private.advance_job(new.job_id, 'estimate');
  elsif new.kind = 'estimate' and new.status = 'accepted' then perform private.advance_job(new.job_id, 'sold');
  elsif new.kind = 'invoice' and new.status = 'sent' then perform private.advance_job(new.job_id, 'invoiced');
  end if;
  return null;
end $$;
create trigger documents_after_write after insert or update of status on public.documents
for each row execute function private.documents_after_write();

create function private.payments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.legacy_id is null and new.amount > private.document_balance(new.document_id) then
    raise exception 'Payment is more than the balance due' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payments_before_insert before insert on public.payments
for each row execute function private.payments_before_insert();

create function private.payments_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  if new.legacy_id is not null then return null; end if;
  select * into d from public.documents where id = new.document_id;
  if d.kind = 'invoice' and d.status = 'draft' then
    update public.documents set status = 'sent' where id = d.id;
  end if;
  if d.kind = 'invoice' and private.document_total(d.items, d.tax_rate) > 0
     and private.document_balance(d.id) <= 0 then
    perform private.advance_job(d.job_id, 'paid');
  end if;
  return null;
end $$;
create trigger payments_after_insert after insert on public.payments
for each row execute function private.payments_after_insert();

-- ---------------------------------------------------------------- calendar
create function private.events_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.legacy_id is not null or new.job_id is null then return null; end if;
  if new.type = 'Install' then perform private.advance_job(new.job_id, 'scheduled');
  elsif new.type = 'Inspection' then perform private.advance_job(new.job_id, 'insp');
  end if;
  return null;
end $$;
create trigger events_after_insert after insert on public.events
for each row execute function private.events_after_insert();

-- ---------------------------------------------------------------- work orders
-- A crew may change only status and crew_notes; timestamps are set here, not by the crew.
create function private.work_orders_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  crew_fields text[] := array['status', 'crew_notes', 'started_at', 'completed_at', 'updated_at'];
begin
  if private.my_role() = 'crew' then
    if (to_jsonb(new) - crew_fields) is distinct from (to_jsonb(old) - crew_fields) then
      raise exception 'Crews can only change the status and crew notes of a work order' using errcode = '42501';
    end if;
    new.started_at := old.started_at;
    new.completed_at := old.completed_at;
  end if;
  new.updated_at := now();
  if new.status <> 'assigned' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'done' and new.completed_at is null then new.completed_at := now(); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger work_orders_before_update before update on public.work_orders
for each row execute function private.work_orders_before_update();

create function private.work_orders_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare crew_name text;
begin
  if new.status is not distinct from old.status then return null; end if;
  select name into crew_name from public.crews where id = new.crew_id;
  insert into public.job_activity (job_id, kind, text)
  values (new.job_id, 'crew', format('%s marked the work order %s', coalesce(crew_name, 'Crew'),
          case new.status when 'in_progress' then 'started' when 'done' then 'done' else 'not started' end));
  if new.status = 'in_progress' then perform private.advance_job(new.job_id, 'progress');
  elsif new.status = 'done' then perform private.advance_job(new.job_id, 'complete');
  end if;
  return null;
end $$;
create trigger work_orders_after_update after update on public.work_orders
for each row execute function private.work_orders_after_update();

-- Builds a price-free work order from the job, its customer and its accepted estimate
-- (or the newest estimate that was not declined).
create function public.create_work_order(p_job uuid, p_crew uuid, p_date date default null) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  j public.jobs;
  c public.contacts;
  d public.documents;
  wid uuid;
begin
  if not private.is_staff() then
    raise exception 'Only office and sales staff can create work orders' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Job not found'; end if;
  select * into c from public.contacts where id = j.contact_id;
  select * into d from public.documents
   where job_id = j.id and kind = 'estimate' and status not in ('declined', 'void')
   order by (status = 'accepted') desc, created_at desc limit 1;

  insert into public.work_orders (job_id, crew_id, scheduled_date, job_number, customer_name, site_address,
                                  site_phone, roof_type, squares, pitch, scope)
  values (j.id, p_crew, p_date, j.number,
          trim(coalesce(c.first, '') || ' ' || coalesce(c.last, '')),
          concat_ws(', ', nullif(c.address, ''), nullif(c.city, ''),
                    nullif(trim(concat_ws(' ', nullif(c.st, ''), nullif(c.zip, ''))), '')),
          coalesce(c.phone, ''), j.roof_type, j.squares, j.pitch,
          coalesce((select jsonb_agg(jsonb_build_object('desc', i ->> 'desc', 'qty', i -> 'qty', 'unit', i ->> 'unit'))
                      from jsonb_array_elements(d.items) i), '[]'::jsonb))
  returning id into wid;

  update public.jobs set crew_id = p_crew where id = j.id;
  insert into public.job_activity (job_id, kind, text)
  values (j.id, 'system', 'Work order created for ' || coalesce((select name from public.crews where id = p_crew), 'crew'));
  return wid;
end $$;
revoke execute on function public.create_work_order(uuid, uuid, date) from public, anon;
grant execute on function public.create_work_order(uuid, uuid, date) to authenticated, service_role;

-- Used once by the prototype importer, after it inserts records with their original numbers.
create function public.sync_number_sequences() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform setval('public.job_number_seq', greatest(coalesce((select max(number) from public.jobs), 0) + 1, 1001), false);
  perform setval('public.estimate_number_seq', coalesce((select max(number) from public.documents where kind = 'estimate'), 0) + 1, false);
  perform setval('public.invoice_number_seq', coalesce((select max(number) from public.documents where kind = 'invoice'), 0) + 1, false);
end $$;
revoke execute on function public.sync_number_sequences() from public, anon, authenticated;
grant execute on function public.sync_number_sequences() to service_role;
