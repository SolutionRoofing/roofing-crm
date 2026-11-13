-- Estimate options (Good / Better / Best, Repair), optional upgrades, product selections and
-- hidden sections — the way Solution Roofing's JobNimbus "Roof Replacement + Repair" layout works.
--
-- documents.options holds every option's lines: [{ "name": "Better", "items": [...] }, ...].
-- documents.items always holds ONE option's lines (the first option until the customer picks),
-- so totals, the Money page, invoices and work orders keep working off items unchanged.
-- When the customer signs they pick an option (and any upgrades); items becomes exactly that.

alter table public.documents
  add column options jsonb not null default '[]'::jsonb,
  add column upgrades jsonb not null default '[]'::jsonb,     -- [{ "name", "desc", "price" }]
  add column selections jsonb not null default '[]'::jsonb,   -- [{ "label", "value" }] e.g. Shingle color
  add column chosen_option int;

alter table public.estimate_templates
  add column options jsonb not null default '[]'::jsonb,
  add column upgrades jsonb not null default '[]'::jsonb,
  add column selections jsonb not null default '[]'::jsonb;

-- What the customer sees for a set of lines: costs and markup removed, and lines in sections marked
-- "hidden" folded into the first visible line (the package line, e.g. "Turtle Tough Roofing System").
create or replace function private.customer_items(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  i jsonb;
  hidden_section boolean := false;
  hidden_total numeric := 0;
  out jsonb := '[]'::jsonb;
  first_item int := null;
  q numeric;
begin
  for i in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if i ->> 'type' = 'section' then
      hidden_section := coalesce(i ->> 'display', '') = 'hidden';
      if not hidden_section then
        out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'type', 'section', 'title', i -> 'title', 'display', i -> 'display', 'show_total', i -> 'show_total')));
      end if;
    elsif hidden_section then
      hidden_total := hidden_total + round(coalesce(nullif(i ->> 'qty', '')::numeric, 0) * coalesce(nullif(i ->> 'price', '')::numeric, 0), 2);
    else
      out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', i -> 'name', 'desc', i -> 'desc', 'unit', i -> 'unit', 'qty', i -> 'qty', 'price', i -> 'price')));
      if first_item is null then first_item := jsonb_array_length(out) - 1; end if;
    end if;
  end loop;

  if hidden_total <> 0 then
    if first_item is null then
      out := out || jsonb_build_array(jsonb_build_object('name', 'Roofing project', 'desc', '', 'unit', 'EA', 'qty', 1, 'price', hidden_total));
    else
      -- Spread the hidden amount over the package line's quantity (qty 0 is treated as 1).
      q := coalesce(nullif(out -> first_item ->> 'qty', '')::numeric, 0);
      if q = 0 then
        out := jsonb_set(out, array[first_item::text, 'qty'], '1'::jsonb);
        q := 1;
      end if;
      out := jsonb_set(out, array[first_item::text, 'price'],
        to_jsonb(round((coalesce(nullif(out -> first_item ->> 'price', '')::numeric, 0) * q + hidden_total) / q, 2)));
    end if;
  end if;
  return out;
end $$;

-- Customer-safe upgrades: name, description, price only.
create or replace function private.customer_upgrades(p_upgrades jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', u ->> 'name', 'desc', coalesce(u ->> 'desc', ''),
                                               'price', coalesce(nullif(u ->> 'price', '')::numeric, 0)) order by n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_upgrades, '[]'::jsonb)) with ordinality as t(u, n)
$$;

create or replace function public.get_shared_document(p_token text, p_track boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  j public.jobs;
  c public.contacts;
  s public.settings;
  paid numeric;
  opts jsonb;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into d from public.documents where share_token = p_token and status <> 'void';
  if d.id is null then return null; end if;
  select * into j from public.jobs where id = d.job_id;
  select * into c from public.contacts where id = j.contact_id;
  select * into s from public.settings where id = 1;
  select coalesce(sum(amount), 0) into paid from public.payments where document_id = d.id;
  if p_track then
    update public.documents set viewed_at = now() where id = d.id and viewed_at is null;
  end if;

  -- Options are only offered while the estimate is open for signing.
  select coalesce(jsonb_agg(jsonb_build_object('name', o ->> 'name', 'items', private.customer_items(o -> 'items'),
                                               'total', private.document_total(o -> 'items', d.tax_rate)) order by n), '[]'::jsonb)
    into opts
    from jsonb_array_elements(case when d.signed_at is null then d.options else '[]'::jsonb end) with ordinality as t(o, n);

  return jsonb_build_object(
    'kind', d.kind, 'number', d.number, 'status', d.status, 'date', d.date, 'due_date', d.due_date,
    'items', private.customer_items(d.items), 'tax_rate', d.tax_rate, 'notes', d.notes,
    'total', private.document_total(d.items, d.tax_rate), 'paid', paid,
    'options', opts,
    'upgrades', case when d.signed_at is null then private.customer_upgrades(d.upgrades) else '[]'::jsonb end,
    'selections', d.selections,
    'signed_name', d.signed_name, 'signed_at', d.signed_at,
    'job', jsonb_build_object('number', j.number, 'name', j.name),
    'customer', jsonb_build_object('first', c.first, 'last', c.last, 'address', c.address, 'city', c.city,
                                   'st', c.st, 'zip', c.zip, 'email', c.email, 'phone', c.phone),
    'company', jsonb_build_object('company', s.company, 'phone', s.phone, 'email', s.email, 'address', s.address,
                                  'license', s.license, 'terms', s.terms));
end $$;

-- Customer signs: picks an option and any upgrades, answers the selection questions.
drop function public.sign_document(text, text, text, text);
create function public.sign_document(p_token text, p_name text, p_signature text, p_ip text default null,
                                     p_option int default null, p_upgrades int[] default null, p_answers jsonb default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  new_items jsonb;
  ups jsonb := '[]'::jsonb;
  answers jsonb;
  u jsonb;
  k int;
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

  -- The chosen option's lines become the estimate.
  new_items := d.items;
  if jsonb_array_length(d.options) > 0 then
    if p_option is null and jsonb_array_length(d.options) > 1 then raise exception 'Please choose an option.'; end if;
    k := coalesce(p_option, 0);
    if k < 0 or k >= jsonb_array_length(d.options) then raise exception 'Please choose an option.'; end if;
    new_items := coalesce(d.options -> k -> 'items', '[]'::jsonb);
  end if;

  -- Picked upgrades are added as their own section.
  if p_upgrades is not null and array_length(p_upgrades, 1) > 0 then
    for k in select distinct x from unnest(p_upgrades) as x loop
      if k < 0 then raise exception 'That upgrade is not available.'; end if;  -- jsonb -> counts negatives from the end
      u := d.upgrades -> k;
      if u is null then raise exception 'That upgrade is not available.'; end if;
      ups := ups || jsonb_build_array(jsonb_build_object(
        'name', u ->> 'name', 'desc', coalesce(u ->> 'desc', ''), 'unit', 'EA', 'qty', 1,
        'mat', 0, 'lab', 0, 'markup', 0, 'price', coalesce(nullif(u ->> 'price', '')::numeric, 0)));
    end loop;
    new_items := new_items || jsonb_build_array(jsonb_build_object('type', 'section', 'title', 'Upgrades', 'display', 'items', 'show_total', false)) || ups;
  end if;

  -- Answers line up with the selection questions; only their text is kept, capped in length.
  select coalesce(jsonb_agg(jsonb_build_object('label', q ->> 'label',
           'value', left(coalesce(p_answers ->> (n - 1)::int, q ->> 'value', ''), 200)) order by n), '[]'::jsonb)
    into answers
    from jsonb_array_elements(d.selections) with ordinality as t(q, n);

  update public.documents
     set status = 'accepted', signed_name = left(trim(p_name), 120), signed_at = now(),
         signed_ip = left(coalesce(p_ip, ''), 64), signature = p_signature,
         items = new_items, chosen_option = case when jsonb_array_length(d.options) > 0 then coalesce(p_option, 0) end,
         selections = answers
   where id = d.id;

  insert into public.job_activity (job_id, kind, text, user_id)
  values (d.job_id, 'system', format('Estimate EST-%s signed online by %s%s', lpad(d.number::text, 2, '0'), left(trim(p_name), 120),
          case when jsonb_array_length(d.options) > 1 then ' (' || coalesce(d.options -> coalesce(p_option, 0) ->> 'name', 'option') || ')' else '' end), null);
  return 'signed';
end $$;
revoke execute on function public.sign_document(text, text, text, text, int, int[], jsonb) from public;
grant execute on function public.sign_document(text, text, text, text, int, int[], jsonb) to anon, authenticated;

-- Signed estimates stay locked, including the options, upgrades and answers.
create or replace function private.documents_signed_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.signed_at is not null and (
       new.items is distinct from old.items or new.tax_rate is distinct from old.tax_rate
    or new.options is distinct from old.options or new.upgrades is distinct from old.upgrades
    or new.selections is distinct from old.selections or new.chosen_option is distinct from old.chosen_option
    or new.signed_at is distinct from old.signed_at or new.signed_name is distinct from old.signed_name
    or new.signature is distinct from old.signature or new.job_id is distinct from old.job_id) then
    raise exception 'This estimate was signed by the customer and can no longer be changed. Make a new estimate instead.'
      using errcode = '42501';
  end if;
  return new;
end $$;
