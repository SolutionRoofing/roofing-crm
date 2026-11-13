-- Private calendar link (iCal feed) each staff member can subscribe to in Google Calendar,
-- Apple Calendar or Outlook. The link holds a secret token; anyone with it can read the
-- appointments, so it can be reset at any time.

alter table public.profiles add column if not exists calendar_token uuid unique default gen_random_uuid();
update public.profiles set calendar_token = gen_random_uuid() where calendar_token is null;

-- Appointments and crew installs for the feed: the token owner's own (p_all = false) or everyone's.
-- Only works for active staff (not crews). Window: 60 days back, 400 days ahead.
create or replace function public.calendar_feed(p_token uuid, p_all boolean default false)
returns table (
  uid text, title text, kind text, ev_date date, ev_time text, notes text,
  job_number int, job_name text, customer text, address text, who text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles
   where calendar_token = p_token and active and role <> 'crew';
  if not found then return; end if;

  return query
  select 'ev-' || e.id::text, e.title, e.type, e.date, e.time, e.notes,
         j.number, j.name,
         trim(coalesce(c.first, '') || ' ' || coalesce(c.last, '')),
         trim(both ', ' from concat_ws(', ', nullif(c.address, ''), nullif(c.city, ''), nullif(trim(concat_ws(' ', c.st, c.zip)), ''))),
         coalesce(cr.name, nullif(p.full_name, ''), p.email, '')
    from public.events e
    left join public.jobs j on j.id = e.job_id
    left join public.contacts c on c.id = j.contact_id
    left join public.profiles p on p.id = e.assignee_id
    left join public.crews cr on cr.id = e.crew_id
   where e.date between current_date - 60 and current_date + 400
     and (p_all or e.assignee_id = v_profile.id
          or (e.assignee_id is null and e.crew_id is null and j.rep_id = v_profile.id))
  union all
  select 'wo-' || w.id::text, coalesce(cr.name, 'Crew') || ': install', 'Install', w.scheduled_date, '', '',
         j.number, j.name,
         trim(coalesce(c.first, '') || ' ' || coalesce(c.last, '')),
         trim(both ', ' from concat_ws(', ', nullif(c.address, ''), nullif(c.city, ''), nullif(trim(concat_ws(' ', c.st, c.zip)), ''))),
         coalesce(cr.name, '')
    from public.work_orders w
    join public.jobs j on j.id = w.job_id
    left join public.contacts c on c.id = j.contact_id
    left join public.crews cr on cr.id = w.crew_id
   where w.scheduled_date between current_date - 60 and current_date + 400
     and (p_all or j.rep_id = v_profile.id);
end $$;

revoke all on function public.calendar_feed(uuid, boolean) from public;
grant execute on function public.calendar_feed(uuid, boolean) to anon, authenticated;

-- New secret for the signed-in user (the old link stops working).
create or replace function public.reset_calendar_token()
returns uuid language sql volatile security definer set search_path = '' as $$
  update public.profiles set calendar_token = gen_random_uuid()
   where id = (select auth.uid()) returning calendar_token;
$$;
revoke all on function public.reset_calendar_token() from public;
grant execute on function public.reset_calendar_token() to authenticated;
