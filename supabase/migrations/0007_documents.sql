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
