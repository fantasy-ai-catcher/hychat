# Design Review Fixes

Fixes for the design-level problems found in the 2026-06-10 review, from docs
to implementation.

## Scope

### 1. `/logout` is permanent account loss (identity model footgun)

Anonymous-auth accounts have no recovery credential. `/logout` becomes a
two-step command: `/logout` prints an explicit warning that the account and
nickname cannot be recovered; `/logout confirm` executes. PRD and README
document the semantics.

### 2. Two-tier invite flow is too convoluted

Invite codes become room-aware:

- `invite_codes.room_id` (nullable). A room-bound code activates the profile
  AND joins the room in one step.
- `create_invite_code(target_room_id default null)`: global codes stay
  admin-only; room-bound codes can be created by the room owner or an admin.
- `/invite-code` inside a room creates a room-bound code; outside a room it
  creates a global one.
- `list_invite_codes()` / `revoke_invite_code(code)` RPCs plus
  `/invite-code list` and `/invite-code revoke <code>` give the issuer
  visibility and control (was: codes could only be created, never listed or
  revoked).

### 3. Quote realtime acceptance criteria had no implementation path

Add `stock_quotes` to the `supabase_realtime` publication and subscribe in the
room channel. RLS already scopes rows to watched symbols. Client applies
incoming quote rows to `quotesBySymbol`.

### 4. No provider quota protection

In the edge resolver:

- `force=true` is throttled: if the last refresh attempt is within
  `forceMinIntervalSeconds` (default 30) and an ok cache row exists, serve the
  cache instead of hitting the provider.
- Failure backoff: when the provider fails, the stale row is upserted so
  `last_refresh_attempt_at` is recorded; within `failureRetrySeconds`
  (default 15) of an attempt, an expired row is served as stale without a new
  provider call (also smooths cache-miss stampedes).

### 5. Message flooding had no server-side limit

`private.enforce_message_rate_limit()` before-insert trigger: max 10 messages
per sender per 10 seconds, raises `rate_limited`.

### 6. Orphan anonymous auth users accumulate forever

`private.cleanup_orphan_anonymous_users(max_age)` deletes anonymous
`auth.users` rows older than `max_age` (default 7 days) that never activated a
profile. For cron/manual ops use only; no client grants.

### 7. Docs-only decisions

- Sender name/color on messages is an intentional write-time snapshot
  (IRC-style); documented in TECHNICAL_DESIGN §5.4 instead of pretending it is
  live data.
- Ink full-screen rendering sacrifices native terminal scrollback; recorded as
  a known limitation with the candidate exit strategies.
- PRD invite flow, logout semantics, rate limit, and quote realtime sections
  updated to match.

## Out of scope (recorded, not fixed)

- Identity recovery / anonymous-to-permanent account upgrade (needs product
  decision on email or passphrase binding).
- Replacing static SQL string tests with local-Supabase behavior tests.
- Message pagination, unread indicators, scrollback UI.

## Tasks

1. Migration `room_invites_and_quota_guards`: invite room binding + list and
   revoke RPCs + `start_profile` room join + rate-limit trigger + stock_quotes
   publication + orphan auth cleanup.
2. Edge resolver throttle/backoff (TDD in `tests/edge`).
3. Client: logout confirm, invite-code subcommands, quote realtime handler
   (TDD in `src/chat`, `src/app`, `src/supabase`).
4. Docs: PRD, TECHNICAL_DESIGN, README.
5. Verify: `pnpm test --run`, `pnpm typecheck`, `pnpm build`,
   `supabase db push`, redeploy edge function, remote smoke checks.
