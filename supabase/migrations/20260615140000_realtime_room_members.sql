-- Publish room_members changes over realtime so existing members see a new
-- member appear in the room header the moment they join. The "members can
-- read room membership" SELECT policy already scopes delivery to fellow room
-- members, so no new policy is needed.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_members'
  ) then
    alter publication supabase_realtime add table public.room_members;
  end if;
end $$;
