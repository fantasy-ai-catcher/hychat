-- Room activity (system) messages.
--
-- A row in `messages` with kind = 'system' records a room event — someone joined
-- or left, created the room, or changed the watchlist — so it shows in every
-- member's chat exactly like a chat line and rides the existing `messages`
-- realtime publication. No new tables, RPCs, or client writes: DB triggers on
-- room_members and room_watchlist insert the system message.
--
-- The triggers are SECURITY DEFINER so they can insert regardless of the actor's
-- RLS — notably a leaving member is no longer a room member and so could not
-- insert a 'left' message under the "members can send messages as themselves"
-- policy. The existing BEFORE-INSERT set_message_sender_display_name trigger
-- still fills sender_display_name/color from sender_id, so activity lines carry
-- the actor's name and color.
--
-- The display text is composed here and stored in `body`; `metadata.event` is
-- kept structured so a future renderer can special-case a type without a schema
-- change, and so a new activity type only needs a new trigger writing a row.
--
-- Logging is best-effort: each insert is wrapped so a failure (message rate
-- limit, or a cascade delete of a room/user that also removes membership/
-- watchlist rows) can never block or break the underlying change.

create or replace function private.log_room_member_activity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.messages (room_id, sender_id, kind, body, metadata)
      values (
        new.room_id,
        new.user_id,
        'system',
        case when new.role = 'owner' then 'created the room' else 'joined the room' end,
        jsonb_build_object(
          'event',
          case when new.role = 'owner' then 'room_create' else 'member_join' end
        )
      );
    elsif tg_op = 'DELETE' then
      insert into public.messages (room_id, sender_id, kind, body, metadata)
      values (
        old.room_id,
        old.user_id,
        'system',
        'left the room',
        jsonb_build_object('event', 'member_leave')
      );
    end if;
  exception when others then
    -- Never let activity logging block the membership change itself.
    null;
  end;
  return null;
end;
$$;

drop trigger if exists log_room_member_activity on public.room_members;
create trigger log_room_member_activity
after insert or delete on public.room_members
for each row
execute function private.log_room_member_activity();

create or replace function private.log_room_watchlist_activity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.messages (room_id, sender_id, kind, body, metadata)
      values (
        new.room_id,
        new.added_by,
        'system',
        'added ' || new.canonical_symbol,
        jsonb_build_object('event', 'watch_add', 'symbol', new.canonical_symbol)
      );
    elsif tg_op = 'DELETE' then
      insert into public.messages (room_id, sender_id, kind, body, metadata)
      values (
        old.room_id,
        coalesce(auth.uid(), old.added_by),
        'system',
        'removed ' || old.canonical_symbol,
        jsonb_build_object('event', 'watch_remove', 'symbol', old.canonical_symbol)
      );
    end if;
  exception when others then
    -- Never let activity logging block the watchlist change itself.
    null;
  end;
  return null;
end;
$$;

drop trigger if exists log_room_watchlist_activity on public.room_watchlist;
create trigger log_room_watchlist_activity
after insert or delete on public.room_watchlist
for each row
execute function private.log_room_watchlist_activity();
