-- Guards on who can change whose access:
-- - nobody can change their own role or switch off their own access (prevents lock-outs);
-- - only an owner can make someone an owner or change an owner's account.
-- Server code using the service key (auth.uid() is null) is trusted and checks this itself.
create function private.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.id = auth.uid() and (new.role is distinct from old.role or not new.active) then
    raise exception 'You cannot change your own role or turn off your own access' using errcode = '42501';
  end if;
  if private.my_role() is distinct from 'owner' and (old.role = 'owner' or new.role = 'owner') then
    raise exception 'Only an owner can make or change an owner' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
for each row execute function private.profiles_guard();
