-- Decouple the display name from identity.
--
-- Identity is the email login. The display name is now a free, changeable
-- label: not unique, defaulted on first login, never required to register.
-- `start_profile(display_name, invite_code)` is replaced by
-- `ensure_profile(invite_code)` (creates the profile with a default name) plus
-- `set_display_name(name)` for renaming any time.

-- 1. Display names no longer have to be unique among active profiles.
drop index if exists public.profiles_display_name_lower_active_idx;

-- 2. Retire the nickname-at-registration RPC.
drop function if exists public.start_profile(text, text);

-- 3. Create the profile for the current login, defaulting the display name to
--    the local-part of the email. An existing profile is returned untouched.
create or replace function public.ensure_profile(invite_code text default null)
returns table (
  id uuid,
  display_name text,
  display_color text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  current_email text;
  default_display_name text;
  active_profile_count int;
  invite_record public.invite_codes%rowtype;
  assigned_role text := 'member';
  result_id uuid;
  result_display_name text;
  result_display_color text;
  result_role text;
  result_status text;
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Existing active profile: return it as-is, never touch the name.
  if exists (
    select 1 from public.profiles p
    where p.id = current_user_id and p.status = 'active'
  ) then
    select p.id, p.display_name, p.display_color, p.role, p.status
    into result_id, result_display_name, result_display_color, result_role, result_status
    from public.profiles p
    where p.id = current_user_id;

    id := result_id;
    display_name := result_display_name;
    display_color := result_display_color;
    role := result_role;
    status := result_status;
    return next;
    return;
  end if;

  select email into current_email from auth.users where auth.users.id = current_user_id;
  default_display_name := nullif(btrim(split_part(coalesce(current_email, ''), '@', 1)), '');
  default_display_name := left(coalesce(default_display_name, 'friend'), 80);

  select count(*) into active_profile_count
  from public.profiles p
  where p.status = 'active';

  if active_profile_count = 0 then
    -- Bootstrap: the very first profile becomes admin without an invite.
    assigned_role := 'admin';
  else
    if invite_code is null or btrim(invite_code) = '' then
      raise exception 'invite_code_required';
    end if;

    select * into invite_record
    from public.invite_codes ic
    where ic.code = btrim(invite_code)
      and ic.used_at is null
      and ic.expires_at > now()
    for update;

    if invite_record.id is null then
      raise exception 'invalid_invite_code';
    end if;

    update public.invite_codes ic
    set used_by = current_user_id, used_at = now()
    where ic.id = invite_record.id;
  end if;

  insert into public.profiles (id, email, display_name, display_color, role, status)
  values (current_user_id, null, default_display_name, 'white', assigned_role, 'active')
  on conflict (id) do update
  set status = 'active',
      updated_at = now(),
      role = case
        when public.profiles.role = 'admin' then public.profiles.role
        else excluded.role
      end
  returning profiles.id, profiles.display_name, profiles.display_color, profiles.role, profiles.status
  into result_id, result_display_name, result_display_color, result_role, result_status;

  -- A room-scoped invite also joins the new member to that room.
  if invite_record.id is not null and invite_record.room_id is not null then
    insert into public.room_members (room_id, user_id, role)
    values (invite_record.room_id, current_user_id, 'member')
    on conflict (room_id, user_id) do nothing;
  end if;

  id := result_id;
  display_name := result_display_name;
  display_color := result_display_color;
  role := result_role;
  status := result_status;
  return next;
end;
$$;

-- 4. Rename the current profile's display name. Names are not unique.
create or replace function public.set_display_name(target_display_name text)
returns table (
  id uuid,
  display_name text,
  display_color text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  normalized text := btrim(target_display_name);
  result_id uuid;
  result_display_name text;
  result_display_color text;
  result_role text;
  result_status text;
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(normalized) < 1 or char_length(normalized) > 80 then
    raise exception 'invalid_display_name';
  end if;

  update public.profiles p
  set display_name = normalized, updated_at = now()
  where p.id = current_user_id and p.status = 'active'
  returning p.id, p.display_name, p.display_color, p.role, p.status
  into result_id, result_display_name, result_display_color, result_role, result_status;

  if result_id is null then
    raise exception 'profile_not_found';
  end if;

  id := result_id;
  display_name := result_display_name;
  display_color := result_display_color;
  role := result_role;
  status := result_status;
  return next;
end;
$$;

-- 5. Only authenticated sessions may call these RPCs (mirrors the existing
--    hardening: HyChat never uses the bare anon key).
revoke execute on function public.ensure_profile(text) from public;
revoke execute on function public.set_display_name(text) from public;
grant execute on function public.ensure_profile(text) to authenticated;
grant execute on function public.set_display_name(text) to authenticated;
