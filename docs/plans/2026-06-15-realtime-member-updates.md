# Realtime member updates

## Problem

When a friend joins a room, members already in the room do not see the new
member appear in the header (`Members: …`) until they re-run `/members` or
re-enter the room. Two tmux clients in the same room confirm it: the joiner's
header updates, the existing member's does not.

## Cause

`subscribeToRoomRealtime` (src/supabase/realtime.ts) subscribes to
`postgres_changes` for `messages`, `room_watchlist`, and `stock_quotes`, but
not `room_members`. `room_members` is also not in the `supabase_realtime`
publication. So an INSERT into `room_members` is never delivered to other
clients.

## Fix

1. Add `public.room_members` to the `supabase_realtime` publication (new
   migration). The existing SELECT RLS policy ("members can read room
   membership") already lets every room member read membership rows, so
   realtime will deliver the change to existing members.
2. Add an `onMembersChange` handler to `subscribeToRoomRealtime`, subscribing
   to `*` events on `room_members` filtered by `room_id`.
3. In `createChatSession`, on `onMembersChange`, reload the member list for the
   active room and emit a fresh snapshot.

## Verification

- L1 unit tests for the new handler wiring + members reload (chat-session).
- `pnpm typecheck` + `pnpm test`.
- `supabase db push` for the publication migration.
- Smoke run with `pnpm dev:tmux`: two clients, second joins, first updates live.
