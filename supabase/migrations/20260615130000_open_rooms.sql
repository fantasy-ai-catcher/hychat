-- Open rooms for a trusted friend circle: every member can see all rooms with
-- their member counts and self-join any of them. This removes the "invite
-- someone into a room" flow:
--   * /invite <nickname>      -> invite_room_member_by_display_name (dropped)
--   * room-scoped /invite-code -> create_invite_code(target_room_id) (now global)
-- Account-registration invite codes (global, admin-only) stay.
--
-- Discovery and join go through SECURITY DEFINER RPCs, so the existing
-- membership-based RLS on rooms/messages/watchlist is left untouched: you only
-- read a room's contents once join_room has made you a member.

-- 1. List every room with its member count and whether the caller is in it.
create or replace function public.list_rooms_with_counts()
returns table (
  id uuid,
  name text,
  owner_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  member_count bigint,
  is_member boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;

  return query
    select
      r.id,
      r.name,
      r.owner_id,
      r.created_at,
      r.updated_at,
      (select count(*) from public.room_members m where m.room_id = r.id) as member_count,
      exists (
        select 1 from public.room_members m
        where m.room_id = r.id and m.user_id = auth.uid()
      ) as is_member
    from public.rooms r
    order by r.created_at desc;
end;
$$;

-- 2. Self-join any existing room (idempotent).
create or replace function public.join_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;

  if not exists (select 1 from public.rooms r where r.id = target_room_id) then
    raise exception 'room_not_found';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (target_room_id, auth.uid(), 'member')
  on conflict (room_id, user_id) do nothing;
end;
$$;

-- 3. Invite codes are now only for account registration: global, admin-only.
drop function if exists public.create_invite_code(uuid);

create or replace function public.create_invite_code()
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  new_code text;
begin
  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;
  if not private.is_current_user_admin() then
    raise exception 'not_admin';
  end if;

  new_code := lower(replace(gen_random_uuid()::text, '-', ''));
  insert into public.invite_codes (code, created_by, room_id)
  values (new_code, auth.uid(), null);
  return new_code;
end;
$$;

-- 4. Retire the per-name room-invite RPC.
drop function if exists public.invite_room_member_by_display_name(uuid, text);

-- 5. Only authenticated sessions may call these RPCs.
revoke execute on function public.list_rooms_with_counts() from public;
revoke execute on function public.join_room(uuid) from public;
revoke execute on function public.create_invite_code() from public;
grant execute on function public.list_rooms_with_counts() to authenticated;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.create_invite_code() to authenticated;
