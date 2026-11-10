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
