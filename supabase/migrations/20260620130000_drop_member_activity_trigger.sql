-- Room enter/leave now rides Realtime presence: each client renders ephemeral
-- "joined/left the room" lines from presence online/offline changes (so Ctrl+C
-- and reconnects show too), instead of persistent membership-row messages.
-- Drop the membership-based activity trigger added in 20260620120000.
--
-- The watchlist activity trigger (add/remove a stock) stays: those are
-- meaningful, persistent events worth keeping in history.
drop trigger if exists log_room_member_activity on public.room_members;
drop function if exists private.log_room_member_activity();
