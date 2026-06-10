# HyChat

Node.js terminal chat MVP backed by Supabase. HyChat is designed for a small private friend group, with room chat, shared stock watchlists, and current quote display for US, Hong Kong, and China A-share symbols.

## Current Scope

Implemented MVP:

1. TypeScript CLI project with Vitest.
2. Runtime env validation.
3. Interactive Ink terminal UI with slash commands.
4. Canonical stock symbols such as `AAPL.US`, `0700.HK`, `600519.CN`.
5. Supabase schema migration with RLS and explicit Data API grants.
6. Supabase anonymous Auth with nickname profiles, invite codes, and local session persistence.
7. Stock quote Edge Function with current quote cache and Twelve Data adapter.
8. Room creation, room join, nickname invite, member listing, message history, and realtime message/watchlist updates.
9. Shared room watchlist and manual quote refresh.

## Requirements

1. Node.js 22 or newer.
2. pnpm 10.
3. Supabase CLI for local database and Edge Function work.
4. A Supabase project or local Supabase stack.
5. A Twelve Data API key for stock quotes.

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in:

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
STOCK_PROVIDER=twelve_data
STOCK_QUOTE_CACHE_TTL_SECONDS=60
```

Edge Function secrets are configured in Supabase, not exposed to the terminal client:

```bash
supabase secrets set TWELVE_DATA_API_KEY=... STOCK_QUOTE_CACHE_TTL_SECONDS=60
```

Supabase automatically injects `SUPABASE_URL` and service credentials for deployed functions. Do not place a service role key in terminal client env files.

## Development Commands

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
pnpm dev
```

For local multi-user testing, run separate terminals with named local session
profiles:

```bash
hychat --profile liudong
hychat --profile test
```

If the named local profile has no saved session yet, HyChat automatically starts
or activates that Supabase user with the profile name as the nickname. When the
default `hychat` session is signed in as an admin, HyChat uses it to generate the
invite code needed for the new local profile. The default `hychat` command still
uses the single machine session at `~/.hychat/session.json` and requires explicit
`/start` the first time.

## Terminal Commands

```text
/start [nickname] [invite-code]
/logout confirm
/create <room name>
/rooms
/join <room id|room name>
/invite <nickname>
/invite-code
/invite-code list
/invite-code revoke <code>
/members
/watch add <symbol>
/watch remove <symbol>
/stock <symbol>
/refresh [symbol]
/color
/color list
/color set <color>
/help
/quit
```

The first activated profile becomes the admin. Run `/start` to use the default local username, or `/start <nickname>`.

Invite codes come in two flavors. Running `/invite-code` inside a room (as the room owner or admin) creates a room-bound code: a friend activating with `/start <nickname> <code>` joins that room in the same step. Running it outside a room creates a global activation code (admin only). Use `/invite-code list` and `/invite-code revoke <code>` to manage codes you issued.

Accounts are anonymous Supabase users: the local session file is the only credential. `/logout` warns and requires `/logout confirm` because a logged-out anonymous account cannot be recovered.

Use `/members` inside a room to list every member with their role and selected profile color.

## Supabase

The database migrations are:

```text
supabase/migrations/20260606000000_initial_schema.sql
supabase/migrations/20260609090028_nickname_invites.sql
supabase/migrations/20260610072815_fix_start_profile_ambiguous_id.sql
supabase/migrations/20260610073049_fix_start_profile_variable_conflict.sql
supabase/migrations/20260610073307_allow_setup_start_before_invites.sql
supabase/migrations/20260610073537_fix_invite_code_generation.sql
supabase/migrations/20260610074931_list_room_members.sql
supabase/migrations/20260610181000_profile_colors.sql
supabase/migrations/20260610190000_harden_access_and_cleanup.sql
supabase/migrations/20260610191500_minimum_data_api_grants.sql
supabase/migrations/20260610192500_restrict_function_execute.sql
supabase/migrations/20260610200000_room_invites_and_quota_guards.sql
```

It creates:

1. `profiles`
2. `rooms`
3. `room_members`
4. `messages`
5. `room_watchlist`
6. `stock_quotes`
7. `invite_codes`

All public app tables enable RLS. Tables exposed through the Data API include explicit `GRANT` statements for `authenticated`. Private membership and profile helper functions live in the non-exposed `private` schema to avoid RLS recursion in policies. Anonymous Auth users cannot create rooms or send messages until their `profiles.status` is `active`.

## Stock Quotes

MVP provider: Twelve Data.

HyChat stores only the current quote cache:

```text
stock_quotes.canonical_symbol primary key
```

There is no quote history table. Refreshes overwrite the same row. Default TTL is 60 seconds.

Supported canonical symbol examples:

```text
AAPL.US
TSLA.US
0700.HK
9988.HK
600519.CN
000001.CN
```

## Tests

The test suite includes:

1. Env parsing.
2. Command parsing.
3. Session persistence and chat session command execution.
4. Symbol parsing and cache policy.
5. Static Supabase SQL checks.
6. Repository and service query construction.
7. Edge quote resolver behavior.
8. Realtime subscription wiring.
9. UI state reducer and App composition.

Run all:

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
```
