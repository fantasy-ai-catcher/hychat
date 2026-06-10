create or replace function public.create_invite_code()
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  new_code text;
begin
  if not private.is_current_user_admin() then
    raise exception 'not_admin';
  end if;

  new_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

  insert into public.invite_codes (code, created_by)
  values (new_code, auth.uid());

  return new_code;
end;
$$;

revoke all on function public.create_invite_code() from public;
grant execute on function public.create_invite_code() to authenticated;
