# Decouple display name from identity + frictionless local testing

Date: 2026-06-15

## Why

Two problems surfaced while smoke-testing the chat room:

1. **Identity and display name are coupled.** `start_profile` requires a
   `display_name` at registration, the name is unique among active profiles
   (`profiles_display_name_lower_active_idx`), and there is no command to
   change it later. Onboarding a friend means picking a globally-unique
   nickname up front, and a typo/clash blocks login.
2. **Local multi-account testing is painful and error-prone.** Registering two
   test accounts means two real emails, OTP codes that expire the moment you
   re-run `/start`, and invite codes. During testing the two `--profile`
   sessions even ended up holding each other's tokens ("two bobs").

The product is for a few trusted friends. Identity should be the email; the
display name should be a free, changeable label.

## Design

### Identity model

- **Email = identity** (unchanged). Login stays email OTP.
- **Display name = decoupled label.** Not unique, changeable any time, gets a
  sensible default on first login (local-part of the email).
- **Invite codes stay** as the friend-circle gate for brand-new profiles
  (first ever profile becomes admin without one). They are now independent of
  the display name.

### Database (new migration)

- Drop `profiles_display_name_lower_active_idx` (names no longer unique).
- Replace `start_profile(target_display_name, invite_code)` with
  `ensure_profile(invite_code default null)`:
  - Existing active profile → return it untouched (never overwrites the name).
  - New profile → create with `display_name = split_part(email,'@',1)`
    (fallback `friend`), applying the same invite-code gate as before.
- Add `set_display_name(target_display_name)` (mirrors `update_profile_color`).
- Lock both functions down to the `authenticated` role.

### Client

- `/start <email> [invite-code]` — no nickname. Usage/help updated.
- After `/verify`, if the email has no profile yet, auto-create it with
  `ensure_profile` (default name) instead of demanding a nickname.
- New `/name <new name>` (alias `/nick`) to rename any time.
- `hychat-service`: `startProfile` → `ensureProfile(inviteCode?)`; add
  `setDisplayName(name)`.

### Local testing

- `scripts/dev-login.mjs <profile...>` uses the service-role key to mint a real
  session for synthetic emails (`<profile>@hychat.test`), upsert the profile,
  and write the session straight into the `--profile` session file. Launching
  `pnpm dev --profile alice` then drops you in already logged in — no email, no
  OTP, no invite code.
- `scripts/dev-tmux.sh` (`pnpm dev:tmux`) runs dev-login for alice+bob and
  opens a tmux layout with both clients side by side.

## Test strategy

- Layer 1 (TDD): `commands.test.ts` for the new `/start` and `/name` parsing;
  `chat-session.test.ts` for the verify→ensureProfile path and `/name`.
- Layer 3 (Supabase): new migration + `supabase db push` + smoke run with the
  dev-login script and two real clients exchanging a message.

## Verification

- `pnpm typecheck`, `pnpm test`.
- `supabase db push`.
- Smoke run: `pnpm dev:tmux`, send a message from alice, confirm bob receives
  it live; rename with `/name` and confirm it shows in the room.

## Follow-up: open rooms (same day)

Non-unique display names exposed that `/invite <nickname>` could silently
invite the wrong person. Rather than patch that, we made rooms open for the
trusted circle (migration `20260615130000_open_rooms.sql`):

- New `list_rooms_with_counts()` RPC: every room + member count + whether the
  caller is in it.
- New `join_room(room_id)` RPC: self-join any room (idempotent).
- `create_invite_code` is now global-only (account registration); the
  room-scoped variant and `invite_room_member_by_display_name` are dropped.
- Client: `/rooms` lists all rooms with counts and a `(joined)` marker;
  `/join` self-joins then enters; `/invite <nickname>` removed.
- RLS on rooms/messages/watchlist is unchanged — discovery and join go through
  SECURITY DEFINER RPCs, so you still only read a room's contents once you are
  a member.

Verified end-to-end against the remote DB with alice + bob's real sessions:
discover (is_member false) → self-join → alice sends → bob reads the message.
