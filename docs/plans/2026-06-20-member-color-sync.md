# Member panel color not synced with profile color changes

## Problem

When a member runs `/color set <color>`, the new color shows up on their **chat
messages** but not on their entry in the **Members** header panel. In the
screenshot, `bob`'s messages render cyan but `bob` in the members list stays the
default white, on every client.

## Root cause

Two different sources feed the two places a name's color is rendered:

- **Messages**: each message row snapshots `sender_display_color` at insert time
  (server-side), so a freshly-sent message always carries the up-to-date color.
- **Members panel** (`App.tsx` → `member.displayColor`): comes from the
  `list_room_members` RPC, loaded only on room join and refreshed only on
  `room_members` postgres changes (`onMembersChange`).

`/color set` writes the `profiles` table. That touches neither `room_members`
nor the message stream by itself, so no client ever refreshes the member color.
It stays stale until the room is re-joined.

## Fix (simplest that works)

Keep the member panel's color in sync using data that already flows, no new
realtime plumbing:

1. **Reducer, `message-received`**: when a `text` message arrives with a
   `senderColor`, patch that sender's `displayColor` in `membersByRoom` for that
   room. This covers every remote member and the sender's own echo — the panel
   tracks each member's most recent known color. (Layer 1, strict TDD.)
2. **Reducer, new `member-color-changed { userId, color }`**: patch a user's
   `displayColor` across all rooms. Dispatched from `/color set` so the user
   sees their own color update immediately, without having to send a message.
   (Layer 1, strict TDD.)

Late joiners still get the correct color from `list_room_members` on join, so no
persistence change is needed.

## Out of scope

- No `profiles` realtime subscription / broadcast event — message-driven sync is
  enough for a handful of friends and adds zero moving parts.
