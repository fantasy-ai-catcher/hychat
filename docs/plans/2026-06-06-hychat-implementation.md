# HyChat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node.js terminal chat MVP backed by Supabase, with room chat, stock watchlists, current-quote caching, and provider abstraction.

**Architecture:** The terminal client is a TypeScript CLI using Ink for UI and `@supabase/supabase-js` for Auth/Data API/Realtime. Supabase stores rooms, members, messages, watchlists, and current quote cache. Stock provider details stay behind a Supabase Edge Function adapter so Twelve Data can be replaced later.

**Tech Stack:** Node.js 22, TypeScript, pnpm, Vitest, Ink, React, zod, commander, @supabase/supabase-js, Supabase CLI/SQL migrations, Supabase Edge Functions.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Create: `src/types.ts`
- Create: `.env.example`

**Steps:**
1. Create minimal Node.js TypeScript project metadata and scripts.
2. Add a smoke test target through Vitest configuration.
3. Run `pnpm install`.
4. Run `pnpm test -- --run` and `pnpm typecheck`.
5. Commit as `chore: scaffold Node.js TypeScript CLI`.

## Task 2: Environment Configuration

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/env.test.ts`

**Steps:**
1. Write failing tests for required Supabase env vars and default stock cache TTL.
2. Run `pnpm test -- --run src/config/env.test.ts` and verify RED.
3. Implement zod-based env parsing.
4. Run targeted tests, then full `pnpm test -- --run` and `pnpm typecheck`.
5. Commit as `feat: validate runtime configuration`.

## Task 3: Command Parser

**Files:**
- Create: `src/chat/commands.ts`
- Create: `src/chat/commands.test.ts`

**Steps:**
1. Write failing tests for normal message input and slash commands: `/help`, `/rooms`, `/join`, `/watch add`, `/watch remove`, `/stock`, `/refresh`, `/quit`.
2. Run targeted tests and verify RED.
3. Implement a small parser returning typed command objects.
4. Run targeted tests, full tests, and typecheck.
5. Commit as `feat: add terminal command parser`.

## Task 4: Stock Symbol and Provider Abstraction

**Files:**
- Create: `src/stocks/symbols.ts`
- Create: `src/stocks/symbols.test.ts`
- Create: `src/stocks/provider.ts`
- Create: `src/stocks/cache.ts`
- Create: `src/stocks/cache.test.ts`

**Steps:**
1. Write failing tests for canonical symbol parsing: `AAPL`, `AAPL.US`, `0700.HK`, `600519.CN`, `000001.CN`, invalid symbols, and ambiguous numeric symbols.
2. Write failing tests for cache decisions: hit, miss, expired, stale fallback.
3. Run targeted tests and verify RED.
4. Implement canonical symbol helpers, provider interface types, and cache policy helpers.
5. Run targeted tests, full tests, and typecheck.
6. Commit as `feat: add stock symbol and cache primitives`.

## Task 5: Supabase SQL Schema

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20260606000000_initial_schema.sql`
- Create: `tests/sql/schema.test.ts`

**Steps:**
1. Write static SQL tests checking required tables, RLS, grants, and quote cache fields.
2. Run targeted tests and verify RED.
3. Add Supabase config and initial migration for profiles, rooms, room_members, messages, room_watchlist, stock_quotes, trigger functions, and cleanup functions.
4. Run targeted tests, full tests, and typecheck.
5. Commit as `feat: add Supabase schema and RLS policies`.

## Task 6: Supabase Client Services

**Files:**
- Create: `src/supabase/client.ts`
- Create: `src/supabase/repositories.ts`
- Create: `src/supabase/repositories.test.ts`
- Create: `src/supabase/realtime.ts`

**Steps:**
1. Write failing tests for repository query construction using an injected Supabase-like client.
2. Run targeted tests and verify RED.
3. Implement auth/session client factory, room/message/watchlist repositories, and Realtime topic helpers.
4. Run targeted tests, full tests, and typecheck.
5. Commit as `feat: add Supabase client services`.

## Task 7: Edge Function Stock Quotes

**Files:**
- Create: `supabase/functions/get-stock-quotes/index.ts`
- Create: `supabase/functions/_shared/stocks/provider.ts`
- Create: `supabase/functions/_shared/stocks/twelve-data.ts`
- Create: `supabase/functions/_shared/stocks/cache.ts`
- Create: `tests/edge/get-stock-quotes.test.ts`

**Steps:**
1. Write tests for request validation, cache hit response, provider refresh response, and stale fallback.
2. Run targeted tests and verify RED.
3. Implement Edge Function modules with adapter boundary and sanitized provider payloads.
4. Run targeted tests, full tests, and typecheck.
5. Commit as `feat: add stock quote edge function`.

## Task 8: Terminal UI MVP

**Files:**
- Create: `src/ui/App.tsx`
- Create: `src/ui/App.test.tsx`
- Create: `src/ui/state.ts`
- Create: `src/ui/state.test.ts`
- Modify: `src/cli.ts`

**Steps:**
1. Write failing tests for state reducer behavior: loading rooms, joining room, receiving messages, updating watchlist, updating quotes.
2. Run targeted tests and verify RED.
3. Implement Ink app shell, reducer, command dispatch wiring, and CLI entrypoint.
4. Run targeted tests, full tests, typecheck, and `pnpm build`.
5. Commit as `feat: add terminal UI MVP`.

## Task 9: Documentation and Local Runbook

**Files:**
- Create: `README.md`
- Modify: `.env.example`
- Modify: `docs/TECHNICAL_DESIGN.md`

**Steps:**
1. Add setup instructions for Supabase, Twelve Data, local env, tests, and CLI run.
2. Run docs grep checks for required env vars and commands.
3. Run full tests, typecheck, and build.
4. Commit as `docs: add local development runbook`.

