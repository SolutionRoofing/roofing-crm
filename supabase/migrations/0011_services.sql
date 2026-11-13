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
