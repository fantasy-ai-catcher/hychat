# HyChat

Node.js terminal chat MVP backed by Supabase. HyChat is designed for a small private friend group, with room chat, shared stock watchlists, and current quote display for US, Hong Kong, and China A-share symbols.

## Current Scope

Implemented foundations:

1. TypeScript CLI project with Vitest.
2. Runtime env validation.
3. Terminal slash command parser.
4. Canonical stock symbols such as `AAPL.US`, `0700.HK`, `600519.CN`.
5. Supabase schema migration with RLS and explicit Data API grants.
6. Supabase client repository helpers.
7. Stock quote Edge Function with current quote cache and Twelve Data adapter.
8. Ink terminal UI shell and state reducer.

The UI shell is intentionally minimal. Real Supabase auth/session prompts and live Realtime wiring are the next implementation step.

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
supabase secrets set TWELVE_DATA_API_KEY=...
```

Supabase automatically injects `SUPABASE_URL` and service credentials for deployed functions. Do not place a service role key in terminal client env files.

## Development Commands

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
pnpm dev
```

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
3. Symbol parsing and cache policy.
4. Static Supabase SQL checks.
5. Repository query construction.
6. Edge quote resolver behavior.
7. UI state reducer.

Run all:

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
```
