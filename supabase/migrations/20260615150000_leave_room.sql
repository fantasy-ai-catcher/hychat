-- Let any member leave a room they are in. The existing delete policy only
-- lets a room owner remove *other* members (user_id <> auth.uid()), so a
-- self-leave needs its own SECURITY DEFINER RPC, mirroring join_room. A room
-- with no members left is fine: list_rooms_with_counts still shows it and
-- anyone can join_room back into it.
create or replace function public.leave_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;

  delete from public.room_members
  where room_id = target_room_id
    and user_id = auth.uid();
end;
$$;

revoke execute on function public.leave_room(uuid) from public;
grant execute on function public.leave_room(uuid) to authenticated;
