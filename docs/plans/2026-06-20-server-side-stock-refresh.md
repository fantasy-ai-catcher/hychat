# Server-side scheduled stock refresh (room-scoped, batched)

Date: 2026-06-20
Branch: `feature/server-side-stock-refresh`

## Problem

Stock quotes only refresh on discrete events (room join, `/refresh`, `/stock`,
watchlist change). While everyone sits in a room idle, prices freeze. We want
automatic refresh, but naive approaches blow free-tier limits:

- N members polling → N simultaneous requests (thundering herd).
- Per-row `postgres_changes` sync → realtime messages scale with
  symbols × viewers, which exceeds the ~2M/month free quota at 10s cadence.
- Per-symbol Yahoo fetch → request rate scales with symbol count, risking
  throttling from a shared egress IP.

## Decision

Refresh on a **server-side schedule, keyed by room**, gated on: (1) the room has
a recent presence heartbeat, and (2) the room has a watchlist. Crucially, both
the fetch and the push are **batched** so cost is independent of symbol count:

- **One Yahoo request** per tick for all symbols, via the v7 batch quote route
  (`/v7/finance/quote?symbols=A,B,C&crumb=…`). Verified working across US / HK /
  CN / JP in one call. Needs a cookie + crumb, cached and refreshed on rejection.
- **One realtime Broadcast** per active room per tick carrying that room's
  quotes, instead of per-row `postgres_changes`. Realtime usage becomes
  ticks × viewers, independent of how many symbols are watched.

At 10s cadence this keeps every free quota comfortable: Yahoo ≈ 1 req/tick,
Edge ≈ 1 invocation/tick, Realtime ≈ viewers messages/tick. All inside Supabase
free tier — zero recurring cost.

### Why a heartbeat table

Presence today is ephemeral Realtime channel state (`channel.track`), not in
Postgres, so cron can't see who's online. We persist a `room_presence(room_id,
user_id, last_seen)` heartbeat; a room counts as present if any `last_seen` is
within a staleness window.

## Architecture

```
client (while in a room)
  └─ every ~45s → rpc heartbeat_presence(room_id)  ──▶  room_presence.last_seen = now()

pg_cron (every 10s)
  └─ private.trigger_active_quote_refresh()
       └─ pg_net http_post ─▶ edge fn refresh-active-quotes (x-cron-secret)
            └─ rpc active_rooms_with_symbols(stale)  → (room_id, symbol) for present rooms
            └─ resolveStockQuotes(distinct symbols, force=false)
                 └─ ONE v7 batch request (cookie+crumb from public.yahoo_auth)
                 └─ upsert stock_quotes (TTL-gated)
            └─ ONE broadcast per room → topic room:<id>:updates, event "quotes"

client realtime: .on('broadcast', {event:'quotes'}) → apply quotes-updated
```

## Changes

### Migration `20260620120000_active_room_quote_refresh.sql`

- `pg_cron`, `pg_net` extensions.
- `public.room_presence` heartbeat table (RLS on, no client grants).
- `heartbeat_presence(room_id)` SECURITY DEFINER RPC (active profile + member),
  granted to `authenticated`.
- `active_rooms_with_symbols(stale_after_seconds)` SECURITY DEFINER returning
  `(room_id, canonical_symbol)` for present rooms; granted to `service_role`.
- `public.yahoo_auth` single-row table for the v7 cookie + crumb (RLS on, no
  client grants; service_role-only via Data API).
- `private.trigger_active_quote_refresh()` reads function URL + cron secret from
  Vault and `net.http_post`s the edge fn; no-op until Vault is set.
- `cron.schedule('refresh-active-quotes', '10 seconds', …)`.
- `enforce_watchlist_cap` trigger: 50 symbols per room (a v7 batch handles 50 in
  one request, so this is a guard rail, not a limit).

### Edge functions (`_shared/stocks` shared by both)

- `provider.ts`: `EdgeStockProvider.getQuotes(symbols[])` batch contract;
  `YahooAuth` / `YahooAuthStore` types.
- `yahoo.ts`: v7 batch provider. Reuses a persisted cookie+crumb; re-auths
  (`fc.yahoo.com` cookie → `/v1/test/getcrumb`) only on 401/403, then retries.
- `cache.ts`: `resolveStockQuotes` batches — reads all cache rows, computes the
  set still needing a hit (same TTL / force / failure-backoff rules), does ONE
  `provider.getQuotes`, upserts. Missing item → `symbol_not_found`; whole-batch
  throw → all attempted fail and serve stale.
- `store.ts`: `createSupabaseQuoteCache` (stock_quotes mapping) +
  `createYahooAuthStore` (yahoo_auth read/write).
- `get-stock-quotes/index.ts`: uses the batch provider + auth store.
- `refresh-active-quotes/index.ts`: cron-triggered, `x-cron-secret` auth,
  `verify_jwt=false`. Fetches active rooms, batch-refreshes the deduped union,
  broadcasts each room its own quotes via `POST /realtime/v1/api/broadcast`.

### Client

- `hychat-service.ts`: `touchPresence(roomId)` → `heartbeat_presence` RPC.
- `chat-session.ts`: presence heartbeat interval (45s, < 90s stale window);
  `onQuotesUpdate(quotes[])` applies a batched broadcast to the quote map.
- `supabase/realtime.ts`: quote sync switched from `postgres_changes` on
  `stock_quotes` to a `broadcast` of event `quotes` on the room channel.

## Test strategy

- **Layer 1 / edge logic (vitest covers `tests/edge`):**
  - `cache.test`: batch resolver — cache hit vs. single batched fetch, missing →
    not_found, force/throttle/stale backoff preserved.
  - `yahoo.test`: v7 batch parse, market suffix mapping, omitted symbols, cookie
    + crumb auth, 401 re-auth + retry.
  - `chat-session.test`: heartbeat lifecycle; batched broadcast → quote map.
  - `realtime.test`: broadcast `quotes` subscription wiring.
- **Layer 3 (migration + edge deploy):** smoke only. Two clients in a room with
  a watchlist; observe quotes auto-update with nobody touching `/refresh`, and
  stop when all leave. **First smoke check: confirm v7 works from Supabase's edge
  egress IP** (the API was verified from a local IP; the datacenter IP may be
  throttled differently).

## Manual / one-time setup (cannot be committed)

After `supabase db push`:

1. `supabase functions deploy refresh-active-quotes --no-verify-jwt`
   (and redeploy `get-stock-quotes`).
2. `supabase secrets set STOCK_REFRESH_CRON_SECRET=<random>`
   and `STOCK_QUOTE_CACHE_TTL_SECONDS=10`.
3. Vault (SQL, once):
   ```sql
   select vault.create_secret(
     'https://<ref>.supabase.co/functions/v1/refresh-active-quotes',
     'refresh_active_quotes_url');
   select vault.create_secret('<same-random>', 'stock_refresh_cron_secret');
   ```

## Tuning

- Freshness is governed by `STOCK_QUOTE_CACHE_TTL_SECONDS` (default 10) — the
  cron tick only does a real fetch when the cache has expired. Keep cron ≤ TTL.
- `stale_after_seconds` (90) must stay > client `heartbeatIntervalMs` (45s).

## Out of scope

- Market-hours gating (Yahoo `marketState` is already in the payload if wanted
  later). With batching it's 1 request regardless, so low value.
- "Skip broadcast when unchanged": batching already decoupled cost from symbol
  count, so not needed for the quotas; could add later to cut idle traffic.
- `room_presence` pruning: bounded by rooms × members, overwritten in place.
