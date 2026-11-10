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
