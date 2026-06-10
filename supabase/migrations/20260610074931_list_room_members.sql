create or replace function public.list_room_members(target_room_id uuid)
returns table (
  room_id uuid,
  user_id uuid,
  display_name text,
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
