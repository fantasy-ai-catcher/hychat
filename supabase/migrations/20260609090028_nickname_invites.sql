alter table public.profiles
  alter column email drop not null;

alter table public.profiles
  add column if not exists role text not null default 'member'
    check (role in ('admin', 'member'));

alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'disabled'));

create unique index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(display_name));

update public.profiles
set role = 'admin',
    status = 'active',
    updated_at = now()
where id = (
  select p.id
  from public.profiles p
  where p.status = 'active'
  order by p.created_at asc
  limit 1
)
and not exists (
  select 1
  from public.profiles p
  where p.role = 'admin'
    and p.status = 'active'
);

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;

alter table public.messages
  add column if not exists sender_display_name text;

update public.messages m
set sender_display_name = coalesce(p.display_name, m.sender_id::text)
from public.profiles p
where p.id = m.sender_id
  and m.sender_display_name is null;

update public.messages
set sender_display_name = sender_id::text
where sender_display_name is null;

alter table public.messages
  alter column sender_display_name set not null,
  alter column sender_display_name set default '';

revoke insert, update on public.profiles from authenticated;

grant select on public.profiles to authenticated;
grant select on public.invite_codes to authenticated;

drop policy if exists "users can insert their own profile" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "users can create owned rooms" on public.rooms;
drop policy if exists "owners can add members" on public.room_members;
drop policy if exists "room owners can add themselves" on public.room_members;
drop policy if exists "members can send messages as themselves" on public.messages;
drop policy if exists "members can add watchlist symbols" on public.room_watchlist;

create or replace function private.is_current_user_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
  );
$$;

create or replace function private.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.role = 'admin'
  );
$$;

grant execute on function private.is_current_user_active_profile() to authenticated;
grant execute on function private.is_current_user_admin() to authenticated;

create policy "active users can create owned rooms"
on public.rooms for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and private.is_current_user_active_profile()
);

create policy "active room owners can add themselves"
on public.room_members for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and private.is_current_user_active_profile()
  and exists (
    select 1
    from public.rooms r
    where r.id = room_id
      and r.owner_id = (select auth.uid())
  )
);

create policy "active members can send messages as themselves"
on public.messages for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_current_user_active_profile()
  and private.is_current_user_room_member(room_id)
);

create policy "active members can add watchlist symbols"
on public.room_watchlist for insert
to authenticated
with check (
  added_by = (select auth.uid())
  and private.is_current_user_active_profile()
  and private.is_current_user_room_member(room_id)
);

create or replace function private.set_message_sender_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.display_name
  into new.sender_display_name
  from public.profiles p
  where p.id = new.sender_id
    and p.status = 'active';

  if new.sender_display_name is null then
    new.sender_display_name := new.sender_id::text;
  end if;

  return new;
end;
$$;

drop trigger if exists set_message_sender_display_name on public.messages;
create trigger set_message_sender_display_name
before insert on public.messages
for each row
execute function private.set_message_sender_display_name();

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
    into id, display_name, role, status;

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

    update public.invite_codes
    set used_by = current_user_id,
        used_at = now()
    where id = invite_record.id;
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
  into id, display_name, role, status;

  return next;
end;
$$;

revoke all on function public.start_profile(text, text) from public;
grant execute on function public.start_profile(text, text) to authenticated;

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

  new_code := lower(encode(gen_random_bytes(8), 'hex'));

  insert into public.invite_codes (code, created_by)
  values (new_code, auth.uid());

  return new_code;
end;
$$;

revoke all on function public.create_invite_code() from public;
grant execute on function public.create_invite_code() to authenticated;

drop function if exists public.invite_room_member_by_email(uuid, text);

create or replace function public.invite_room_member_by_display_name(
  target_room_id uuid,
  target_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_user_id uuid;
begin
  if not private.is_current_user_room_owner(target_room_id) then
    raise exception 'not_room_owner';
  end if;

  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;

  select p.id
  into target_user_id
  from public.profiles p
  where lower(p.display_name) = lower(btrim(target_display_name))
    and p.status = 'active';

  if target_user_id is null then
    raise exception 'profile_not_found';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (target_room_id, target_user_id, 'member')
  on conflict (room_id, user_id) do update set role = excluded.role;

  return target_user_id;
end;
$$;

revoke all on function public.invite_room_member_by_display_name(uuid, text) from public;
grant execute on function public.invite_room_member_by_display_name(uuid, text) to authenticated;
