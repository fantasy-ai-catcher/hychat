create or replace function public.start_profile(
  target_display_name text,
  invite_code text default null
)
returns table (
  id uuid,
  display_name text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_display_name text := btrim(target_display_name);
  active_profile_count int;
  invite_record public.invite_codes%rowtype;
  assigned_role text := 'member';
  result_id uuid;
  result_display_name text;
  result_role text;
  result_status text;
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(normalized_display_name) < 1 or char_length(normalized_display_name) > 80 then
    raise exception 'invalid_display_name';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = current_user_id
      and p.status = 'active'
  ) then
    update public.profiles p
    set display_name = normalized_display_name,
        updated_at = now()
    where p.id = current_user_id
    returning p.id, p.display_name, p.role, p.status
    into result_id, result_display_name, result_role, result_status;

    id := result_id;
    display_name := result_display_name;
    role := result_role;
    status := result_status;
    return next;
    return;
  end if;

  select count(*)
  into active_profile_count
  from public.profiles p
  where p.status = 'active';

  if active_profile_count = 0 then
    assigned_role := 'admin';
  else
    if invite_code is null or btrim(invite_code) = '' then
      raise exception 'invite_code_required';
    end if;

    select *
    into invite_record
    from public.invite_codes ic
    where ic.code = btrim(invite_code)
      and ic.used_at is null
      and ic.expires_at > now()
    for update;

    if invite_record.id is null then
      raise exception 'invalid_invite_code';
    end if;

    update public.invite_codes ic
    set used_by = current_user_id,
        used_at = now()
    where ic.id = invite_record.id;
  end if;

  insert into public.profiles (id, email, display_name, role, status)
  values (current_user_id, null, normalized_display_name, assigned_role, 'active')
  on conflict (id) do update
  set display_name = excluded.display_name,
      role = case
        when public.profiles.role = 'admin' then public.profiles.role
        else excluded.role
      end,
      status = 'active',
      updated_at = now()
  returning profiles.id, profiles.display_name, profiles.role, profiles.status
  into result_id, result_display_name, result_role, result_status;

  id := result_id;
  display_name := result_display_name;
  role := result_role;
  status := result_status;
  return next;
end;
$$;
