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
