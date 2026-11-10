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
