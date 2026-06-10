alter table public.profiles
  add column if not exists display_color text not null default 'white';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_display_color_check'
  ) then
    alter table public.profiles
      add constraint profiles_display_color_check
      check (
        display_color in (
          'white',
          'red', 'orange', 'amber', 'yellow', 'lime',
          'green', 'mint', 'teal', 'cyan', 'sky',
          'blue', 'indigo', 'violet', 'purple', 'magenta',
          'pink', 'rose', 'coral', 'brown', 'gray'
        )
      );
  end if;
end;
$$;

alter table public.messages
  add column if not exists sender_display_color text not null default 'white';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_sender_display_color_check'
  ) then
    alter table public.messages
      add constraint messages_sender_display_color_check
      check (
        sender_display_color in (
          'white',
          'red', 'orange', 'amber', 'yellow', 'lime',
          'green', 'mint', 'teal', 'cyan', 'sky',
          'blue', 'indigo', 'violet', 'purple', 'magenta',
          'pink', 'rose', 'coral', 'brown', 'gray'
        )
      );
  end if;
end;
$$;

update public.messages m
set sender_display_color = coalesce(p.display_color, 'white')
from public.profiles p
where p.id = m.sender_id;

create or replace function private.set_message_sender_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.display_name, p.display_color
  into new.sender_display_name, new.sender_display_color
  from public.profiles p
  where p.id = new.sender_id
    and p.status = 'active';

  if new.sender_display_name is null then
    new.sender_display_name := new.sender_id::text;
  end if;

  if new.sender_display_color is null then
    new.sender_display_color := 'white';
  end if;

  return new;
end;
$$;

drop function if exists public.start_profile(text, text);

create or replace function public.start_profile(
  target_display_name text,
  invite_code text default null
)
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
  normalized_display_name text := btrim(target_display_name);
  active_profile_count int;
  active_admin_count int;
  invite_code_count int;
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
    returning p.id, p.display_name, p.display_color, p.role, p.status
    into result_id, result_display_name, result_display_color, result_role, result_status;

    id := result_id;
    display_name := result_display_name;
    display_color := result_display_color;
    role := result_role;
    status := result_status;
    return next;
    return;
  end if;

  select count(*)
  into active_profile_count
  from public.profiles p
  where p.status = 'active';

  select count(*)
  into active_admin_count
  from public.profiles p
  where p.status = 'active'
    and p.role = 'admin';

  select count(*)
  into invite_code_count
  from public.invite_codes;

  if active_profile_count = 0 or active_admin_count = 0 or invite_code_count = 0 then
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

  insert into public.profiles (id, email, display_name, display_color, role, status)
  values (current_user_id, null, normalized_display_name, 'white', assigned_role, 'active')
  on conflict (id) do update
  set display_name = excluded.display_name,
      role = case
        when public.profiles.role = 'admin' then public.profiles.role
        else excluded.role
      end,
      status = 'active',
      updated_at = now()
  returning profiles.id, profiles.display_name, profiles.display_color, profiles.role, profiles.status
  into result_id, result_display_name, result_display_color, result_role, result_status;

  id := result_id;
  display_name := result_display_name;
  display_color := result_display_color;
  role := result_role;
  status := result_status;
  return next;
end;
$$;

revoke all on function public.start_profile(text, text) from public;
grant execute on function public.start_profile(text, text) to authenticated;

create or replace function public.update_profile_color(target_display_color text)
returns table (
  id uuid,
  display_name text,
  display_color text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  normalized_display_color text := lower(btrim(target_display_color));
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if normalized_display_color not in (
    'white',
    'red', 'orange', 'amber', 'yellow', 'lime',
    'green', 'mint', 'teal', 'cyan', 'sky',
    'blue', 'indigo', 'violet', 'purple', 'magenta',
    'pink', 'rose', 'coral', 'brown', 'gray'
  ) then
    raise exception 'invalid_display_color';
  end if;

  update public.profiles p
  set display_color = normalized_display_color,
      updated_at = now()
  where p.id = current_user_id
    and p.status = 'active'
  returning p.id, p.display_name, p.display_color, p.role, p.status
  into id, display_name, display_color, role, status;

  if id is null then
    raise exception 'profile_not_found';
  end if;

  return next;
end;
$$;

revoke all on function public.update_profile_color(text) from public;
grant execute on function public.update_profile_color(text) to authenticated;

drop function if exists public.list_room_members(uuid);

create or replace function public.list_room_members(target_room_id uuid)
returns table (
  room_id uuid,
  user_id uuid,
  display_name text,
  display_color text,
  role text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    rm.room_id,
    rm.user_id,
    p.display_name,
    p.display_color,
    rm.role,
    rm.created_at
  from public.room_members rm
  join public.profiles p on p.id = rm.user_id
  where rm.room_id = target_room_id
    and p.status = 'active'
  order by
    case rm.role when 'owner' then 0 else 1 end,
    lower(p.display_name),
    rm.created_at;
$$;

revoke all on function public.list_room_members(uuid) from public;
grant execute on function public.list_room_members(uuid) to authenticated;
