# Room presence + /leave

Give the header member list a meaning closer to "who is in the room right
now", and let anyone leave a room.

## Member status model (agreed direction)

Per-member status, highest priority wins:

| status  | meaning                                   | phase |
| ------- | ----------------------------------------- | ----- |
| typing  | connected and currently typing            | 1     |
| active  | connected AND terminal tab is focused     | 2     |
| online  | connected (tab unfocused, or unknown)     | 1     |
| offline | a member, but no live connection (app shut)| 1     |
| —       | not a member / left via /leave → not shown | 1     |

Decision (user): `/leave` removes membership entirely (not shown). A member
who just closed the app shows as **offline** — derived from "in the member
list but absent from realtime presence", so no tombstone row is needed.

## Phasing

- **Phase 1 (this branch):** `/leave`; presence split of online vs offline;
  typing indicator. No terminal-focus dependency — all robust.
- **Phase 2 (done):** terminal focus reporting (xterm DECSET 1004 / tmux
  focus-events) splits `online` into `active` (tab focused) vs `online`
  (unfocused), shown as `●` / `◐` / `○`. Graceful degradation: a terminal that
  never sends focus events keeps focus = true, so connected == active.
  **Focus travels by broadcast, not presence:** re-`track()`ing presence to
  update a status field accumulates metas instead of replacing them
  (confirmed in testing), so presence carries online/offline only and a
  `focus` broadcast (like typing) carries active/online. On each presence sync
  every client re-broadcasts its focus so a newcomer learns who is active.

## Phase 1 implementation

### /leave
- **DB:** new `public.leave_room(target_room_id uuid)` SECURITY DEFINER RPC
  (mirrors `join_room`): deletes the caller's own `room_members` row. The
  existing delete policy only lets owners remove *others*, so a self-leave RPC
  is required. Idempotent. Migration + `supabase db push`.
- **Service (L3):** `leaveRoom(roomId)` calls the RPC.
- **Command (L1):** parse `/leave` → `{ name: 'leave' }`.
- **Session (L1):** on `/leave`, require active room, call `leaveRoom`,
  unsubscribe realtime, clear active room (reducer `room-left`), reload rooms,
  back to welcome screen. Help text + pending-status entry.

### Presence (online/offline) — L3 + L1
- **Realtime (L3):** open the room channel with `presence: { key: userId }`.
  On `presence sync`, read `channel.presenceState()` and report the set of
  online user ids via a new `onPresenceChange(userIds)` handler. `track({
  user_id })` once SUBSCRIBED; presence auto-clears on disconnect.
- **State (L1):** `onlineByRoom: Record<roomId, string[]>`; reducer action
  `presence-synced { roomId, userIds }`. Pure selector
  `computeMemberStatuses(members, onlineIds, typingIds)` → members + status.

### Typing — L3 + L1 + L2
- **Realtime (L3):** `broadcast` event `typing` on the same channel;
  `sendTyping(userId)` helper; `onTyping(userId)` handler.
- **Session:** the composer signals typing (debounced); session broadcasts and,
  on receive, marks the user typing and schedules a clear after ~3s (timer in
  the imperative shell; reducer just adds/removes from a set).
- **State (L1):** `typingByRoom: Record<roomId, string[]>`; actions
  `typing-started` / `typing-stopped`.

### UI (L2)
- Header `Members:` and `/members` use `computeMemberStatuses`. offline =
  dimmed/gray; online = normal (profile color); typing = trailing marker
  (e.g. `✎`). Keep components thin; all branching in the L1 selector.

## Verification
- L1 unit tests: commands `/leave`; reducer presence/typing actions; the
  `computeMemberStatuses` selector; session `/leave` flow + typing timer.
- `pnpm typecheck` + `pnpm test`.
- `supabase db push` for the `leave_room` migration.
- tmux smoke run: two clients; one closes app → shows offline on the other;
  one types → typing marker on the other; `/leave` → disappears from the list.
