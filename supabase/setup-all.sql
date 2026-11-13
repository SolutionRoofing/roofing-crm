-- Roofing CRM: complete database setup for a NEW Supabase project. Paste into the SQL Editor and Run once.

-- ===== 0001_schema.sql =====
-- Roofing CRM: core schema, permission helpers and row-level security.
-- Roles: owner and office (admins), rep (sales, sees all jobs), crew (1099 subcontractors).
-- Crews never get SELECT on jobs, contacts, documents or payments. They only see the
-- work_orders rows for their crew, which carry no prices (enforced by a CHECK constraint).

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create type public.user_role as enum ('owner', 'office', 'rep', 'crew');

-- ---------------------------------------------------------------- people
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_name text not null default '',
  phone text not null default '',
  email text not null default '',
  active boolean not null default true,
  legacy_id text unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  role public.user_role not null default 'rep',
  crew_id uuid references public.crews (id) on delete set null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint crew_role_needs_crew check (role <> 'crew' or crew_id is not null or not active)
);

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER so policies can read profiles without recursing into profiles' own RLS.
create function private.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('owner', 'office', 'rep'), false)
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() in ('owner', 'office'), false)
$$;

create function private.my_crew() returns uuid
language sql stable security definer set search_path = '' as $$
  select crew_id from public.profiles where id = auth.uid() and active and role = 'crew'
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- New sign-ins get an inactive profile. The very first account becomes the active owner.
-- Everyone else is activated (and given a role) by an owner or office user.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  first_user boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when first_user then 'owner'::public.user_role else 'rep'::public.user_role end,
    first_user
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- settings and catalog
create table public.settings (
  id int primary key default 1 check (id = 1),
  company text not null default 'Your Roofing Company',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  license text not null default '',
  tax_rate numeric(6, 3) not null default 0,
  review_url text not null default '',
  terms text not null default 'Estimate valid for 30 days. Work is subject to the signed contract.',
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  unit text not null default 'EA',
  price numeric(12, 2) not null default 0,
  sort int not null default 0
);

-- ---------------------------------------------------------------- customers and jobs
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  first text not null default '',
  last text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  city text not null default '',
  st text not null default '',
  zip text not null default '',
  source text not null default '',
  tags text not null default '',
  marketing boolean not null default false,
  unsubscribed_at timestamptz,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.job_number_seq start 1001;
create sequence public.estimate_number_seq start 1;
create sequence public.invoice_number_seq start 1;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('public.job_number_seq'),
  name text not null,
  contact_id uuid references public.contacts (id) on delete set null,
  stage text not null default 'lead' check (stage in (
    'lead', 'insp', 'inspected', 'estimate', 'claim', 'sold', 'materials',
    'scheduled', 'progress', 'complete', 'invoiced', 'paid', 'lost')),
  stage_changed_at timestamptz not null default now(),
  type text not null default 'Retail' check (type in ('Retail', 'Insurance')),
  roof_type text not null default '',
  squares numeric(8, 2) not null default 0,
  pitch text not null default '',
  rep_id uuid references public.profiles (id) on delete set null,
  crew_id uuid references public.crews (id) on delete set null,
  value numeric(12, 2) not null default 0,
  sold_at timestamptz,
  lost_reason text not null default '',
  insurance jsonb not null default '{}'::jsonb,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.jobs (stage);
create index on public.jobs (contact_id);

create table public.job_activity (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null default 'system',
  text text not null,
  user_id uuid references public.profiles (id) on delete set null default auth.uid()
);
create index on public.job_activity (job_id, at desc);

-- ---------------------------------------------------------------- money
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('estimate', 'invoice')),
  number int not null,
  job_id uuid not null references public.jobs (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'void')),
  date date not null default current_date,
  due_date date,
  items jsonb not null default '[]'::jsonb,
  tax_rate numeric(6, 3) not null default 0,
  notes text not null default '',
  from_id uuid references public.documents (id) on delete set null,
  legacy_id text unique,
  created_at timestamptz not null default now(),
  unique (kind, number)
);
create index on public.documents (job_id);

create function private.document_number() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.number is null then
    new.number := case new.kind
      when 'estimate' then nextval('public.estimate_number_seq')
      else nextval('public.invoice_number_seq') end;
  end if;
  return new;
end $$;
-- BEFORE triggers run ahead of the NOT NULL check, so an omitted number is filled here.
create trigger documents_number before insert on public.documents
for each row execute function private.document_number();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  date date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default '',
  note text not null default '',
  legacy_id text unique,
  created_at timestamptz not null default now()
);
create index on public.payments (document_id);

-- ---------------------------------------------------------------- work
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  job_id uuid references public.jobs (id) on delete cascade,
  assignee_id uuid references public.profiles (id) on delete set null,
  due date,
  done boolean not null default false,
  legacy_id text unique,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'Other',
  job_id uuid references public.jobs (id) on delete cascade,
  assignee_id uuid references public.profiles (id) on delete set null,
  crew_id uuid references public.crews (id) on delete set null,
  date date not null,
  time text not null default '',
  notes text not null default '',
  legacy_id text unique,
  created_at timestamptz not null default now()
);
create index on public.events (date);

-- Price-free work order for a crew. Customer details are copied in, so crews never
-- need access to contacts or jobs. scope items are {desc, qty, unit} only.
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  crew_id uuid not null references public.crews (id) on delete restrict,
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'done')),
  scheduled_date date,
  job_number int not null,
  customer_name text not null default '',
  site_address text not null default '',
  site_phone text not null default '',
  roof_type text not null default '',
  squares numeric(8, 2) not null default 0,
  pitch text not null default '',
  scope jsonb not null default '[]'::jsonb,
  materials text not null default '',
  access_notes text not null default '',
  crew_notes text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scope_is_array check (jsonb_typeof(scope) = 'array'),
  constraint scope_has_no_prices check (not jsonb_path_exists(scope, '$[*] ? (exists(@.price) || exists(@.amount) || exists(@.total))'))
);
create index on public.work_orders (crew_id, scheduled_date);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  storage_path text not null unique,
  category text not null default 'Before',
  caption text not null default '',
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  taken_at timestamptz not null default now(),
  legacy_id text unique
);
create index on public.photos (job_id);

-- ---------------------------------------------------------------- email
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  kind text not null default 'followup' check (kind in ('followup', 'marketing')),
  subject text not null,
  body text not null
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage text not null,
  delay_days int not null default 0 check (delay_days >= 0),
  template_id uuid not null references public.templates (id) on delete cascade,
  stop_on_exit boolean not null default false,
  active boolean not null default true
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_id uuid references public.templates (id) on delete set null,
  audience_label text not null default '',
  recipient_count int not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.automation_rules (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  template_id uuid references public.templates (id) on delete set null,
  job_id uuid references public.jobs (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  to_email text not null default '',
  subject text not null,
  body text not null,
  kind text not null default 'followup',
  send_at timestamptz not null default now(),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'cancelled', 'skipped', 'failed')),
  reason text not null default '',
  sent_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now()
);
create index on public.outbox (status, send_at);
create index on public.outbox (job_id);

-- ---------------------------------------------------------------- row-level security
alter table public.crews enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.catalog_items enable row level security;
alter table public.contacts enable row level security;
alter table public.jobs enable row level security;
alter table public.job_activity enable row level security;
alter table public.documents enable row level security;
alter table public.payments enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.work_orders enable row level security;
alter table public.photos enable row level security;
alter table public.templates enable row level security;
alter table public.automation_rules enable row level security;
alter table public.campaigns enable row level security;
alter table public.outbox enable row level security;

-- Staff work tables: all staff read and write, only owner/office delete.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'jobs', 'job_activity', 'documents', 'payments', 'campaigns', 'outbox'] loop
    execute format('create policy staff_select on public.%I for select to authenticated using (private.is_staff())', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (private.is_staff())', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (private.is_staff()) with check (private.is_staff())', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using (private.is_admin())', t);
  end loop;
  -- Tasks and calendar events: any staff member can delete.
  foreach t in array array['tasks', 'events'] loop
    execute format('create policy staff_all on public.%I for all to authenticated using (private.is_staff()) with check (private.is_staff())', t);
  end loop;
  -- Company configuration: staff read, owner/office write.
  foreach t in array array['settings', 'catalog_items', 'templates', 'automation_rules'] loop
    execute format('create policy staff_select on public.%I for select to authenticated using (private.is_staff())', t);
    execute format('create policy admin_write on public.%I for all to authenticated using (private.is_admin()) with check (private.is_admin())', t);
  end loop;
end $$;

-- Crews can see their own crew's calendar events (titles and times only matter here).
create policy crew_select on public.events for select to authenticated
  using (crew_id is not null and crew_id = private.my_crew());

-- Profiles: you can see yourself; staff see everyone; only owner/office change anything.
create policy self_or_staff_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_staff());
create policy admin_update on public.profiles for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Crews table.
create policy staff_select on public.crews for select to authenticated using (private.is_staff());
create policy own_crew_select on public.crews for select to authenticated using (id = private.my_crew());
create policy admin_write on public.crews for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Work orders: staff manage; a crew reads and updates only its own.
create policy staff_all on public.work_orders for all to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy crew_select on public.work_orders for select to authenticated
  using (crew_id = private.my_crew());
create policy crew_update on public.work_orders for update to authenticated
  using (crew_id = private.my_crew()) with check (crew_id = private.my_crew());

-- Photos: staff manage; crews see and add photos on jobs they hold a work order for,
-- and can edit or delete only photos they uploaded.
create function private.crew_has_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.work_orders w
    where w.job_id = p_job and w.crew_id = private.my_crew()
  )
$$;
grant execute on function private.crew_has_job(uuid) to authenticated, service_role;

create policy staff_all on public.photos for all to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy crew_select on public.photos for select to authenticated
  using (private.crew_has_job(job_id));
create policy crew_insert on public.photos for insert to authenticated
  with check (private.crew_has_job(job_id) and uploaded_by = auth.uid());
create policy crew_update_own on public.photos for update to authenticated
  using (uploaded_by = auth.uid() and private.crew_has_job(job_id))
  with check (uploaded_by = auth.uid() and private.crew_has_job(job_id));
create policy crew_delete_own on public.photos for delete to authenticated
  using (uploaded_by = auth.uid() and private.crew_has_job(job_id));

-- ===== 0002_logic.sql =====
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

-- ===== 0003_storage.sql =====
-- Private bucket for job photos. Files live at "<job id>/<photo id>.jpg".
-- Staff can do anything in the bucket; a crew can read and upload only under jobs
-- it holds a work order for. Photos are served through short-lived signed URLs.

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

create function private.path_job(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.path_job(text) to authenticated, service_role;

create policy job_photos_staff on storage.objects for all to authenticated
  using (bucket_id = 'job-photos' and private.is_staff())
  with check (bucket_id = 'job-photos' and private.is_staff());

create policy job_photos_crew_read on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and private.crew_has_job(private.path_job(name)));

create policy job_photos_crew_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and private.crew_has_job(private.path_job(name)));

-- ===== 0004_defaults.sql =====
-- Starter email templates, follow-up rules and price list (same as the prototype).
-- Prices are placeholders to replace with your own. The prototype importer replaces
-- all three lists with whatever was in the backup.

insert into public.templates (key, name, kind, subject, body) values
('t_welcome', 'New lead welcome', 'followup', 'Thanks for contacting {{company}}',
 E'Hi {{first_name}},\n\nThanks for reaching out about the roof at {{address}}. {{rep_name}} will contact you shortly to set up a free inspection.\n\nQuestions in the meantime? Call us at {{company_phone}}.\n\n{{company}}'),
('t_est1', 'Estimate follow-up 1', 'followup', 'Any questions about your roofing estimate?',
 E'Hi {{first_name}},\n\nI wanted to check that you received your estimate for {{address}}. Happy to walk through any of it with you.\n\n{{rep_name}}\n{{company}} | {{company_phone}}'),
('t_est2', 'Estimate follow-up 2', 'followup', 'Still thinking over your roof?',
 E'Hi {{first_name}},\n\nJust following up on your roofing estimate. If the timing or scope needs adjusting, let me know and we can work through it together.\n\n{{rep_name}}\n{{company}} | {{company_phone}}'),
('t_claim', 'Claim check-in', 'followup', 'Checking in on your insurance claim',
 E'Hi {{first_name}},\n\nHas your insurance carrier sent an update or a scope of loss for {{address}}? If so, send it over and we will review it for anything that was missed.\n\n{{rep_name}}\n{{company}} | {{company_phone}}'),
('t_install', 'Install preparation', 'followup', 'Getting ready for your new roof',
 E'Hi {{first_name}},\n\nYour install at {{address}} is on the schedule. Before the crew arrives, please move vehicles out of the driveway and take down fragile items hanging on interior walls.\n\nQuestions? Call us at {{company_phone}}.\n\n{{company}}'),
('t_review', 'Review request', 'followup', 'How did we do, {{first_name}}?',
 E'Hi {{first_name}},\n\nThank you for trusting {{company}} with your roof. If you are happy with the work, a short review would mean a lot to our team:\n\n{{review_link}}\n\n{{rep_name}}'),
('t_referral', 'Referral ask', 'followup', 'Know a neighbor who needs a roof?',
 E'Hi {{first_name}},\n\nWe hope your new roof is treating you well. If a friend or neighbor needs a roof inspection, we would be grateful for the introduction.\n\n{{company}} | {{company_phone}}'),
('t_lost', 'Lost lead check-back', 'followup', 'Still need help with your roof?',
 E'Hi {{first_name}},\n\nIt has been a while since we talked about the roof at {{address}}. If anything has changed, we would be glad to take another look.\n\n{{company}} | {{company_phone}}'),
('t_storm', 'Storm season inspection offer', 'marketing', 'Free roof inspection after storm season',
 E'Hi {{first_name}},\n\nHail and wind damage is not always visible from the ground. {{company}} is offering free roof inspections for homeowners in the area this month.\n\nReply to this email or call {{company_phone}} to get on the schedule.'),
('t_maint', 'Annual maintenance reminder', 'marketing', 'Time for your annual roof check-up',
 E'Hi {{first_name}},\n\nA quick yearly check-up catches small problems before they turn into leaks. Reply to this email or call {{company_phone}} and we will find a time.\n\n{{company}}');

insert into public.automation_rules (name, stage, delay_days, template_id, stop_on_exit)
select r.name, r.stage, r.delay_days, t.id, r.stop_on_exit
  from (values
    ('Welcome new leads', 'lead', 0, 't_welcome', false),
    ('Estimate follow-up after 2 days', 'estimate', 2, 't_est1', true),
    ('Estimate follow-up after 5 days', 'estimate', 5, 't_est2', true),
    ('Claim check-in after 7 days', 'claim', 7, 't_claim', true),
    ('Install preparation', 'scheduled', 0, 't_install', false),
    ('Ask for a review', 'complete', 3, 't_review', false),
    ('Ask for referrals', 'paid', 30, 't_referral', false),
    ('Check back on lost leads', 'lost', 90, 't_lost', true)
  ) as r (name, stage, delay_days, key, stop_on_exit)
  join public.templates t on t.key = r.key;

insert into public.catalog_items (description, unit, price, sort) values
('Tear-off existing roofing', 'SQ', 65, 1),
('Architectural shingles, installed', 'SQ', 340, 2),
('Synthetic underlayment', 'SQ', 25, 3),
('Ice & water shield', 'SQ', 110, 4),
('Steep pitch charge', 'SQ', 40, 5),
('Drip edge', 'LF', 3.5, 6),
('Ridge vent', 'LF', 9, 7),
('Step flashing', 'LF', 18, 8),
('Pipe boot', 'EA', 45, 9),
('Dumpster & disposal', 'EA', 550, 10),
('Permit', 'EA', 250, 11);

-- ===== 0005_profile_guard.sql =====
-- Guards on who can change whose access:
-- - nobody can change their own role or switch off their own access (prevents lock-outs);
-- - only an owner can make someone an owner or change an owner's account.
-- Server code using the service key (auth.uid() is null) is trusted and checks this itself.
create function private.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.id = auth.uid() and (new.role is distinct from old.role or not new.active) then
    raise exception 'You cannot change your own role or turn off your own access' using errcode = '42501';
  end if;
  if private.my_role() is distinct from 'owner' and (old.role = 'owner' or new.role = 'owner') then
    raise exception 'Only an owner can make or change an owner' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
for each row execute function private.profiles_guard();

-- ===== 0006_phase2.sql =====
-- Phase 2: list view for the pipeline and jobs screens, self-service profile edits,
-- and live updates so a change on one screen shows up on everyone else's.

-- Jobs with customer, rep and current value. security_invoker makes the view obey the
-- caller's permissions, so crews (who can't read jobs) get nothing from it.
create view public.job_list with (security_invoker = true) as
select
  j.id, j.number, j.name, j.stage, j.stage_changed_at, j.type, j.roof_type, j.squares, j.pitch,
  j.rep_id, j.crew_id, j.contact_id, j.sold_at, j.lost_reason, j.created_at,
  trim(coalesce(c.first, '') || ' ' || coalesce(c.last, '')) as customer_name,
  coalesce(c.address, '') as address,
  coalesce(c.city, '') as city,
  coalesce(c.phone, '') as phone,
  coalesce(p.full_name, '') as rep_name,
  coalesce((
    select private.document_total(d.items, d.tax_rate)
      from public.documents d
     where d.job_id = j.id and d.kind = 'estimate' and d.status not in ('declined', 'void')
     order by (d.status = 'accepted') desc, d.created_at desc
     limit 1), j.value) as amount
from public.jobs j
left join public.contacts c on c.id = j.contact_id
left join public.profiles p on p.id = j.rep_id;

grant select on public.job_list to authenticated;

-- Anyone signed in can fix their own name and phone, without the power to change roles.
create function public.update_my_profile(p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  update public.profiles
     set full_name = left(trim(coalesce(p_full_name, '')), 120),
         phone = left(trim(coalesce(p_phone, '')), 40)
   where id = auth.uid();
end $$;
revoke execute on function public.update_my_profile(text, text) from public, anon;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- Live updates (Supabase Realtime respects the same row-level security).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.jobs, public.contacts, public.tasks, public.events, public.work_orders, public.job_activity;
  end if;
end $$;

-- ===== 0007_documents.sql =====
-- Phase 4: customer share links, e-signing of estimates, and protection for signed estimates.
--
-- A share link is a long random token. Signed-out customers never touch the tables directly
-- (row-level security still blocks them); they go through two SECURITY DEFINER functions that
-- only ever return or change the single document the token belongs to.

alter table public.documents
  add column share_token text unique,
  add column sent_at timestamptz,
  add column viewed_at timestamptz,
  add column signed_name text,
  add column signed_at timestamptz,
  add column signed_ip text,
  add column signature text;

-- Once a customer has signed, the price and scope they agreed to can't be edited.
create function private.documents_signed_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.signed_at is not null and (
       new.items is distinct from old.items or new.tax_rate is distinct from old.tax_rate
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature is distinct from old.signature or new.job_id is distinct from old.job_id) then
    raise exception 'This estimate was signed by the customer and can no longer be changed. Make a new estimate instead.'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger documents_signed_lock before update on public.documents
for each row execute function private.documents_signed_lock();

-- Staff: create (or reuse) the share link. Marks a draft as sent.
create function public.share_document(p_doc uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare token text;
begin
  if not private.is_staff() then
    raise exception 'Only office and sales staff can share documents' using errcode = '42501';
  end if;
  update public.documents
     set share_token = coalesce(share_token, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
         status = case when status = 'draft' then 'sent' else status end,
         sent_at = coalesce(sent_at, now())
   where id = p_doc and status <> 'void'
  returning share_token into token;
  if token is null then raise exception 'Document not found'; end if;
  return token;
end $$;
revoke execute on function public.share_document(uuid) from public, anon;
grant execute on function public.share_document(uuid) to authenticated;

-- Customer: read one shared document. Returns null for unknown, short or voided tokens.
create function public.get_shared_document(p_token text, p_track boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  j public.jobs;
  c public.contacts;
  s public.settings;
  paid numeric;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into d from public.documents where share_token = p_token and status <> 'void';
  if d.id is null then return null; end if;
  select * into j from public.jobs where id = d.job_id;
  select * into c from public.contacts where id = j.contact_id;
  select * into s from public.settings where id = 1;
  select coalesce(sum(amount), 0) into paid from public.payments where document_id = d.id;

  -- Staff previewing their own link pass p_track = false so it doesn't count as the customer opening it.
  if p_track then
    update public.documents set viewed_at = now() where id = d.id and viewed_at is null;
  end if;

  return jsonb_build_object(
    'kind', d.kind, 'number', d.number, 'status', d.status, 'date', d.date, 'due_date', d.due_date,
    'items', d.items, 'tax_rate', d.tax_rate, 'notes', d.notes,
    'total', private.document_total(d.items, d.tax_rate), 'paid', paid,
    'signed_name', d.signed_name, 'signed_at', d.signed_at,
    'job', jsonb_build_object('number', j.number, 'name', j.name),
    'customer', jsonb_build_object('first', c.first, 'last', c.last, 'address', c.address, 'city', c.city,
                                   'st', c.st, 'zip', c.zip, 'email', c.email, 'phone', c.phone),
    'company', jsonb_build_object('company', s.company, 'phone', s.phone, 'email', s.email, 'address', s.address,
                                  'license', s.license, 'terms', s.terms));
end $$;

-- Customer: sign a shared estimate. Accepting it moves the job to Sold (documents trigger).
create function public.sign_document(p_token text, p_name text, p_signature text, p_ip text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  if p_token is null or length(p_token) < 40 then raise exception 'This link is not valid.'; end if;
  select * into d from public.documents where share_token = p_token for update;
  if d.id is null or d.status = 'void' then raise exception 'This link is not valid.'; end if;
  if d.kind <> 'estimate' then raise exception 'Only estimates can be signed.'; end if;
  if d.signed_at is not null then raise exception 'This estimate has already been signed.'; end if;
  if d.status <> 'sent' then raise exception 'This estimate is no longer open for signing. Please contact us.'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Please type your full name.'; end if;
  if p_signature is not null and (length(p_signature) > 300000 or p_signature not like 'data:image/png;base64,%') then
    raise exception 'The signature could not be read. Please try again.';
  end if;

  update public.documents
     set status = 'accepted', signed_name = left(trim(p_name), 120), signed_at = now(),
         signed_ip = left(coalesce(p_ip, ''), 64), signature = p_signature
   where id = d.id;

  insert into public.job_activity (job_id, kind, text, user_id)
  values (d.job_id, 'system', format('Estimate EST-%s signed online by %s', lpad(d.number::text, 2, '0'), left(trim(p_name), 120)), null);
  return 'signed';
end $$;

revoke execute on function public.get_shared_document(text, boolean) from public;
revoke execute on function public.sign_document(text, text, text, text) from public;
grant execute on function public.get_shared_document(text, boolean) to anon, authenticated;
grant execute on function public.sign_document(text, text, text, text) to anon, authenticated;

-- ===== 0008_photos.sql =====
-- Phase 3: job photos from phones.
-- Each photo is stored twice in the private bucket: a full image (max 1600px) and a small
-- thumbnail for galleries, both shrunk on the phone before upload.

alter table public.photos add column thumb_path text;

-- Only images, at most 10 MB each (phones upload ~300 KB after shrinking).
update storage.buckets
   set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'job-photos';

-- New photos show up on everyone's screen without a reload.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;

-- Crews can remove the files of photos they uploaded themselves (staff can remove any).
create policy job_photos_crew_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and owner_id = (select auth.uid())::text
         and private.crew_has_job(private.path_job(name)));

-- ===== 0009_email.sql =====
-- Phase 5: real email sending.
-- The sender (a scheduled server job using the service key) claims due emails from the
-- outbox, sends them through Resend and records the result. Every customer gets a private
-- unsubscribe link; unsubscribing turns off marketing and cancels queued marketing emails.

alter table public.contacts
  add column unsubscribe_token text unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
update public.contacts
   set unsubscribe_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where unsubscribe_token is null;
alter table public.contacts alter column unsubscribe_token set not null;

alter table public.outbox
  add column attempts int not null default 0,
  add column claimed_at timestamptz,
  add column delivered_at timestamptz,
  add column opened_at timestamptz,
  add column bounced_at timestamptz,
  add column document_id uuid references public.documents (id) on delete set null;
create index on public.outbox (provider_id);

-- Hands the sender up to p_limit due emails and marks them 'sending' so two runs never
-- send the same email. Emails stuck in 'sending' for 30 minutes (a crashed run) go back
-- in the queue; after 5 attempts they are marked failed.
create function public.claim_outbox(p_limit int default 50) returns setof public.outbox
language plpgsql security definer set search_path = '' as $$
begin
  update public.outbox
     set status = case when attempts >= 5 then 'failed' else 'scheduled' end,
         reason = case when attempts >= 5 then 'Gave up after 5 attempts' else reason end
   where status = 'sending' and claimed_at < now() - interval '30 minutes';

  return query
  update public.outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.outbox
      where status = 'scheduled' and send_at <= now()
      order by send_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked)
  returning o.*;
end $$;
revoke execute on function public.claim_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int) to service_role;

-- Public unsubscribe page: what to show (company name and a masked email).
create function public.unsubscribe_info(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.contacts; s public.settings;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into c from public.contacts where unsubscribe_token = p_token;
  if c.id is null then return null; end if;
  select * into s from public.settings where id = 1;
  return jsonb_build_object(
    'company', s.company,
    'email', regexp_replace(c.email, '^(.).*(@.*)$', '\1•••\2'),
    'unsubscribed', c.unsubscribed_at is not null);
end $$;

-- Unsubscribe from marketing. Follow-ups about the customer's own job still go out.
create function public.unsubscribe_contact(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.contacts;
begin
  if p_token is null or length(p_token) < 40 then return false; end if;
  select * into c from public.contacts where unsubscribe_token = p_token;
  if c.id is null then return false; end if;
  update public.contacts set marketing = false, unsubscribed_at = coalesce(unsubscribed_at, now()) where id = c.id;
  update public.outbox set status = 'cancelled', reason = 'Customer unsubscribed'
   where contact_id = c.id and kind = 'marketing' and status = 'scheduled';
  return true;
end $$;

revoke execute on function public.unsubscribe_info(text) from public;
revoke execute on function public.unsubscribe_contact(text) from public;
grant execute on function public.unsubscribe_info(text) to anon, authenticated;
grant execute on function public.unsubscribe_contact(text) to anon, authenticated;

-- ===== 0010_usage.sql =====
-- Usage numbers for the Settings > Plan usage panel, so admins see when a
-- free-plan limit is getting close (see UPGRADES.md). Admins only.
create or replace function public.plan_usage() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed';
  end if;
  return json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0),
    'emails_today', (select count(*) from public.outbox where status = 'sent' and sent_at >= date_trunc('day', now())),
    'emails_month', (select count(*) from public.outbox where status = 'sent' and sent_at >= date_trunc('month', now()))
  );
end $$;
revoke execute on function public.plan_usage() from public, anon;
grant execute on function public.plan_usage() to authenticated;

-- ===== 0011_services.sql =====
-- What work a job covers (roof replacement, gutters, ...). A job can have several.
-- Insurance stays separate in jobs.type ('Insurance' turns on the Claim section).
alter table public.jobs add column services text[] not null default '{}'
  constraint jobs_services_check check (services <@ array[
    'Roof replacement', 'Roof repair', 'Gutters', 'Siding', 'Window/door replacement', 'Chimney repair'
  ]::text[]);

-- Jobs created before this were all re-roofs.
update public.jobs set services = '{Roof replacement}' where services = '{}';

-- Same view as 0006, with services added at the end.
create or replace view public.job_list with (security_invoker = true) as
select
  j.id, j.number, j.name, j.stage, j.stage_changed_at, j.type, j.roof_type, j.squares, j.pitch,
  j.rep_id, j.crew_id, j.contact_id, j.sold_at, j.lost_reason, j.created_at,
  trim(coalesce(c.first, '') || ' ' || coalesce(c.last, '')) as customer_name,
  coalesce(c.address, '') as address,
  coalesce(c.city, '') as city,
  coalesce(c.phone, '') as phone,
  coalesce(p.full_name, '') as rep_name,
  coalesce((
    select private.document_total(d.items, d.tax_rate)
      from public.documents d
     where d.job_id = j.id and d.kind = 'estimate' and d.status not in ('declined', 'void')
     order by (d.status = 'accepted') desc, d.created_at desc
     limit 1), j.value) as amount,
  j.services
from public.jobs j
left join public.contacts c on c.id = j.contact_id
left join public.profiles p on p.id = j.rep_id;

-- ===== 0012_photo_shares.sql =====
-- Customer photo links: staff pick photos on a job and send the customer a private link.
-- Like estimate links, customers never touch the tables: a SECURITY DEFINER function returns
-- only the photos picked for that one token. Links keep working until someone turns them off.

create table public.photo_shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  job_id uuid not null references public.jobs (id) on delete cascade,
  photo_ids uuid[] not null,
  message text not null default '',
  sent_to text not null default '',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  viewed_at timestamptz,
  revoked_at timestamptz
);
create index on public.photo_shares (job_id);

alter table public.photo_shares enable row level security;
create policy staff_select on public.photo_shares for select to authenticated using (private.is_staff());
create policy staff_update on public.photo_shares for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
revoke all on public.photo_shares from anon, authenticated;
grant select, update (revoked_at, sent_to) on public.photo_shares to authenticated;

-- Staff: make a link for some of a job's photos. Photos from other jobs are ignored.
create function public.share_photos(p_job uuid, p_photo_ids uuid[], p_message text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not private.is_staff() then
    raise exception 'Only office and sales staff can share photos' using errcode = '42501';
  end if;
  select array_agg(id) into ids from public.photos where job_id = p_job and id = any(p_photo_ids);
  if ids is null then raise exception 'Pick at least one photo to share.'; end if;
  insert into public.photo_shares (token, job_id, photo_ids, message)
  values (tok, p_job, ids, left(trim(coalesce(p_message, '')), 1000));
  return tok;
end $$;
revoke execute on function public.share_photos(uuid, uuid[], text) from public, anon;
grant execute on function public.share_photos(uuid, uuid[], text) to authenticated;

-- Customer: the photos behind one link. Null for unknown, short or turned-off links.
-- Photos deleted from the job since then simply drop out.
create function public.get_shared_photos(p_token text, p_track boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sh public.photo_shares;
  j public.jobs;
  c public.contacts;
  s public.settings;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into sh from public.photo_shares where token = p_token and revoked_at is null;
  if sh.id is null then return null; end if;
  select * into j from public.jobs where id = sh.job_id;
  select * into c from public.contacts where id = j.contact_id;
  select * into s from public.settings where id = 1;
  if p_track then
    update public.photo_shares set viewed_at = now() where id = sh.id and viewed_at is null;
  end if;
  return jsonb_build_object(
    'message', sh.message, 'created_at', sh.created_at,
    'customer', jsonb_build_object('first', c.first, 'address', c.address, 'city', c.city, 'st', c.st),
    'company', jsonb_build_object('company', s.company, 'phone', s.phone, 'email', s.email),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.storage_path, 'thumb', coalesce(p.thumb_path, p.storage_path),
                                          'caption', p.caption, 'taken_at', p.taken_at) order by p.taken_at)
        from public.photos p where p.job_id = sh.job_id and p.id = any(sh.photo_ids)), '[]'::jsonb));
end $$;
revoke execute on function public.get_shared_photos(text, boolean) from public;
grant execute on function public.get_shared_photos(text, boolean) to anon, authenticated;

-- ===== 0013_estimate_builder.sql =====
-- Estimate builder, JobNimbus style: products carry material cost, labor cost and markup;
-- estimate lines can be grouped under sections; the sales tax the company pays on materials
-- counts toward cost (so margin is right) without showing up on the customer's estimate.

-- Price list: item name + long description, separate material/labor cost and a markup.
alter table public.catalog_items
  add column name text not null default '',
  add column material_cost numeric(12, 2) not null default 0,
  add column labor_cost numeric(12, 2) not null default 0,
  add column markup numeric(8, 2) not null default 0,
  add column category text not null default '';
-- Until now "description" held the short item name.
update public.catalog_items set name = description, description = '' where name = '';
alter table public.catalog_items alter column description set default '';
alter table public.catalog_items add constraint catalog_items_name_check check (length(trim(name)) > 0);

-- Tax paid to suppliers on materials. Separate from sales tax charged to customers (tax_rate).
alter table public.settings add column material_tax_rate numeric(6, 3) not null default 0
  check (material_tax_rate >= 0 and material_tax_rate <= 25);

-- Each estimate keeps the material tax rate it was priced with, plus notes only staff see.
alter table public.documents
  add column material_tax_rate numeric(6, 3) not null default 0,
  add column internal_notes text not null default '';

-- Saved estimate templates ("Save as template" / "Start from template").
create table public.estimate_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  items jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.estimate_templates enable row level security;
create policy staff_select on public.estimate_templates for select to authenticated using (private.is_staff());
create policy staff_insert on public.estimate_templates for insert to authenticated with check (private.is_staff());
create policy staff_update on public.estimate_templates for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
-- Owner/office can delete any template; reps can delete their own.
create policy staff_delete on public.estimate_templates for delete to authenticated
  using (private.is_admin() or (private.is_staff() and created_by = auth.uid()));

-- Customers must never receive costs, markup or internal notes: only these fields of each line go out.
create or replace function private.customer_items(p_items jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'type', i -> 'type', 'name', i -> 'name', 'desc', i -> 'desc', 'unit', i -> 'unit',
           'qty', i -> 'qty', 'price', i -> 'price',
           'title', i -> 'title', 'display', i -> 'display', 'show_total', i -> 'show_total')) order by n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, n)
$$;

create or replace function public.get_shared_document(p_token text, p_track boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  j public.jobs;
  c public.contacts;
  s public.settings;
  paid numeric;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into d from public.documents where share_token = p_token and status <> 'void';
  if d.id is null then return null; end if;
  select * into j from public.jobs where id = d.job_id;
  select * into c from public.contacts where id = j.contact_id;
  select * into s from public.settings where id = 1;
  select coalesce(sum(amount), 0) into paid from public.payments where document_id = d.id;

  -- Staff previewing their own link pass p_track = false so it doesn't count as the customer opening it.
  if p_track then
    update public.documents set viewed_at = now() where id = d.id and viewed_at is null;
  end if;

  return jsonb_build_object(
    'kind', d.kind, 'number', d.number, 'status', d.status, 'date', d.date, 'due_date', d.due_date,
    'items', private.customer_items(d.items), 'tax_rate', d.tax_rate, 'notes', d.notes,
    'total', private.document_total(d.items, d.tax_rate), 'paid', paid,
    'signed_name', d.signed_name, 'signed_at', d.signed_at,
    'job', jsonb_build_object('number', j.number, 'name', j.name),
    'customer', jsonb_build_object('first', c.first, 'last', c.last, 'address', c.address, 'city', c.city,
                                   'st', c.st, 'zip', c.zip, 'email', c.email, 'phone', c.phone),
    'company', jsonb_build_object('company', s.company, 'phone', s.phone, 'email', s.email, 'address', s.address,
                                  'license', s.license, 'terms', s.terms));
end $$;

-- Crew work orders list each item by its name (not the long customer description) and skip sections.
create or replace function public.create_work_order(p_job uuid, p_crew uuid, p_date date default null) returns uuid
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
          coalesce((select jsonb_agg(jsonb_build_object('desc', coalesce(nullif(i ->> 'name', ''), i ->> 'desc'),
                                                        'qty', i -> 'qty', 'unit', i ->> 'unit') order by n)
                      from jsonb_array_elements(coalesce(d.items, '[]'::jsonb)) with ordinality as t(i, n)
                     where coalesce(i ->> 'type', 'item') <> 'section'), '[]'::jsonb))
  returning id into wid;

  update public.jobs set crew_id = p_crew where id = j.id;
  insert into public.job_activity (job_id, kind, text)
  values (j.id, 'system', 'Work order created for ' || coalesce((select name from public.crews where id = p_crew), 'crew'));
  return wid;
end $$;
