-- Usage numbers for the Settings > Plan usage panel, so admins see when a
-- free-plan limit is getting close (see UPGRADES.md). Admins only.
create or replace function public.plan_usage() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed';
  end if;
  return json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0),
    'emails_today', (select count(*) from public.outbox where status = 'sent' and sent_at >= date_trunc('day', now())),
    'emails_month', (select count(*) from public.outbox where status = 'sent' and sent_at >= date_trunc('month', now()))
  );
end $$;
revoke execute on function public.plan_usage() from public, anon;
grant execute on function public.plan_usage() to authenticated;
