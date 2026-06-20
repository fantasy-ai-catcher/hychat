# Room activity (system) messages

## Goal

Show room-activity lines in the chat area in addition to user chat:

- someone joined a room (and, symmetrically, left)
- someone created a room
- someone added a stock to the watchlist
- someone removed a stock

Design to be **generic**: adding a new activity type later should need as little
code as possible.

## Approach

The `messages` table already has everything we need:

- `kind text check (kind in ('text','system'))` and `metadata jsonb`
- it is in the `supabase_realtime` publication (so any inserted row reaches every
  member's client through the existing `onMessage` path)
- a BEFORE-INSERT trigger (`set_message_sender_display_name`) fills
  `sender_display_name` / `sender_display_color` from `sender_id`

So we do **not** add client writes, new RPCs, or new tables. Instead, DB triggers
on `room_members` and `room_watchlist` insert a `kind='system'` message:

| event         | source table / op            | sender_id            | body              | metadata.event |
| ------------- | ---------------------------- | -------------------- | ----------------- | -------------- |
| room_create   | room_members INSERT role=owner | new.user_id        | created the room  | room_create    |
| member_join   | room_members INSERT          | new.user_id          | joined the room   | member_join    |
| member_leave  | room_members DELETE          | old.user_id          | left the room     | member_leave   |
| watch_add     | room_watchlist INSERT        | new.added_by         | added <SYM>       | watch_add      |
| watch_remove  | room_watchlist DELETE        | auth.uid()/added_by  | removed <SYM>     | watch_remove   |

Why triggers over client-side inserts:

- **Robust**: captured server-side regardless of which client/path caused it, and
  delivered to everyone by the existing messages realtime. A leaving member is no
  longer a room member, so they could not insert a "left" message under RLS — a
  `SECURITY DEFINER` trigger can.
- **Fewer app moving parts**: the client only needs to *render* system messages;
  no new service methods.
- **Generic**: a new activity type = a new trigger writing `body` + `metadata`;
  the client renders any `kind='system'` row unchanged.

Activity logging is **best-effort**: each insert is wrapped in an
`exception when others then null` block so it can never block or break the
underlying join/leave/watchlist change (e.g. message rate-limit, or a cascade
delete of a room/user that also removes membership rows).

## Client

- `ChatMessage` gains `kind` + optional `metadata`.
- `state.ts` adds a pure `formatActivityLine(message)` (the one extension seam for
  wording) — tested in Layer 1.
- `MessageViewport` branches on `message.kind`: `text` → `name: body` (today),
  `system` → a dim activity line with a leading `·` marker. Timestamp toggle still
  applies.

## Verification

- `pnpm typecheck` + `pnpm test` (Layer 1 reducer/format + Layer 2 render + SQL
  migration text test).
- `supabase db push` (new triggers).
- Smoke run: two clients; join a room, add/remove a stock, watch the activity
  lines appear on both.

## Update — room enter/leave uses presence, not membership

The membership-trigger "joined/left the room" only fires on the first `/join`
and on `/leave`; re-entering a room you already belong to, and Ctrl+C exits,
produce nothing. The chosen semantics is **online/offline (presence)**: each
connect/disconnect (incl. Ctrl+C) shows "X joined/left the room".

- Migration `20260620130000_drop_member_activity_trigger.sql` drops the
  membership trigger/function. The **watchlist** trigger stays (add/remove a
  stock is a meaningful, persistent event).
- Room enter/leave is now **client-side and ephemeral**, derived from Realtime
  presence: `computePresenceTransitions(prev, curr, selfId)` (pure) diffs
  consecutive presence syncs into arrivals/departures; the chat session turns
  them into `kind='system'` lines stored in `activityByRoom` (capped, cleared on
  leave, never persisted). The first sync after joining is the baseline (no
  announcement) so you don't see everyone already present "join".
- `mergeChatTimeline` interleaves persistent messages with these ephemeral lines
  by timestamp; `MessageViewport` renders them centered + dim, same as before.
- Centered system lines: `justifyContent="center"` on the system row.

System activity messages render **centered**; chat stays left-aligned.
