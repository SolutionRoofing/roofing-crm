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
