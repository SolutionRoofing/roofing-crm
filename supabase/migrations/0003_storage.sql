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
