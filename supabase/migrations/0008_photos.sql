-- Phase 3: job photos from phones.
-- Each photo is stored twice in the private bucket: a full image (max 1600px) and a small
-- thumbnail for galleries, both shrunk on the phone before upload.

alter table public.photos add column thumb_path text;

-- Only images, at most 10 MB each (phones upload ~300 KB after shrinking).
update storage.buckets
   set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'job-photos';

-- New photos show up on everyone's screen without a reload.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.photos;
  end if;
end $$;

-- Crews can remove the files of photos they uploaded themselves (staff can remove any).
create policy job_photos_crew_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and owner_id = (select auth.uid())::text
         and private.crew_has_job(private.path_job(name)));
