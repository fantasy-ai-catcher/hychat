# HyChat

Node.js terminal chat MVP backed by Supabase. HyChat is designed for a small private friend group, with room chat, shared stock watchlists, and current quote display for US, Hong Kong, and China A-share symbols.

## Current Scope

Implemented MVP:

1. TypeScript CLI project with Vitest.
2. Runtime env validation.
3. Interactive Ink terminal UI with slash commands.
4. Canonical stock symbols such as `AAPL.US`, `0700.HK`, `600519.CN`.
5. Supabase schema migration with RLS and explicit Data API grants.
6. Supabase Auth login/signup/logout with local session persistence.
7. Stock quote Edge Function with current quote cache and Twelve Data adapter.
8. Room creation, room join, email invite, member listing, message history, and realtime message/watchlist updates.
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

## Terminal Commands

```text
/signup
/signup <email> <password>
/login
/login <email> <password>
/logout
/create <room name>
/rooms
/join <room id|room name>
/invite <email>
/members
/watch add <symbol>
/watch remove <symbol>
/stock <symbol>
/refresh [symbol]
/help
/quit
```

When `/login` or `/signup` is entered without arguments, HyChat prompts for email and masked password.

## Supabase

The initial migration is:

```text
supabase/migrations/20260606000000_initial_schema.sql
```

It creates:

1. `profiles`
2. `rooms`
3. `room_members`
4. `messages`
5. `room_watchlist`
6. `stock_quotes`

All public app tables enable RLS. Tables exposed through the Data API include explicit `GRANT` statements for `authenticated`. Private membership helper functions live in the non-exposed `private` schema to avoid RLS recursion in policies.

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
