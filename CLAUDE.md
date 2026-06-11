# Agent Instructions

## Product intent

HyChat is a terminal chat tool for a small circle of friends. It is a hobby
project: no monetization now or planned, no untrusted users, no scale beyond
a handful of people who know each other.

Let this drive every technical and product decision:

- **Prefer the simplest design that works for a few trusted friends.** Do not
  build for scale, multi-tenancy, abuse resistance, or enterprise concerns.
- **Zero recurring cost.** Stay on free tiers (Supabase free plan, free stock
  APIs). Reject choices that require paid services, even cheap ones.
- **Fewer moving parts beats feature completeness.** A manual step that runs
  once a month is better than automation that adds a service to maintain.
- **Friction is acceptable when it buys robustness.** Users are a few patient
  friends, not customers; a one-time extra step in onboarding is fine if it
  removes a whole failure mode.

## Development methodology

Every change follows the loop: **plan → implement → verify**. Do NOT apply
blanket TDD to the whole codebase; use the layered test strategy below.

### Working loop

0. **Clarify before planning** when the request is subjective or open-ended —
   e.g. "this UI/flow feels bad", a screenshot of a problem, "make X better".
   Do NOT jump to a plan or start changing code. First observe the actual
   behavior (read the screenshot carefully, or smoke-run the app), restate
   the problem as you understand it, then propose 2-3 concrete directions
   with trade-offs and let the user pick one. Only after the direction is
   agreed, write the plan. Requests with a single clear interpretation skip
   this step.
1. For non-trivial work (new feature, behavior change across files), write a
   short plan in `docs/plans/` first, prefixed with the date
   (`YYYY-MM-DD-<topic>.md`). Trivial fixes can skip this.
2. Implement following the layered test strategy.
3. Run `pnpm typecheck` and `pnpm test` (vitest). Both must pass.
4. If the change touches UI rendering or Supabase, also do a real smoke run of
   the app (`pnpm dev`) — typecheck and unit tests cannot catch TUI layout
   problems or schema mismatches.
5. Report results honestly: state what was verified by tests, what was verified
   by a smoke run, and what was not verified at all.

### Layered test strategy

The architecture is "functional core, imperative shell". Keep it that way, and
test each layer differently:

**Layer 1 — pure logic: strict TDD.**
Applies to `src/app/` (chat-session, session-storage, profile-colors, etc.),
`src/ui/state.ts`, and any other code with clear inputs/outputs and no IO.
Write the failing test first, then implement. The test is the spec.

**Layer 2 — UI components (`src/ui/*.tsx`, Ink): test-after, minimal.**
Keep components thin; move any branching or state logic into `state.ts` (or
`src/app/`) where Layer 1 rules apply. Only add render tests for critical
paths. Do not write tests that assert TUI layout details, and do not chase
coverage here.

**Layer 3 — Supabase boundary (`src/supabase/`, realtime/RPC adapters): no
mock-driven TDD.**
Mocks of Supabase responses only restate our own assumptions about the schema
and prove nothing. Keep adapters thin and free of business logic. Verification
for this layer is: migration in `supabase/migrations/` + `supabase db push` +
a real smoke run against the remote database (see "Supabase schema changes").

**Placement rule:** when writing new logic, if it can be expressed as a pure
function, put it in Layer 1 (e.g. `src/app/` or `state.ts`) — never bury
testable logic inside Ink components or Supabase adapters.

## Branch workflow

Before changing code, decide whether the work is a `feature`, `fix`, or `chore`,
then create a new branch for the change. Do not modify code directly on `main`.

Branch names must follow this convention:

- `feature/<short-kebab-description>`
- `fix/<short-kebab-description>`
- `chore/<short-kebab-description>`

After implementation, run the required tests and verification commands on the
branch. Merge back to `main` only after the user explicitly agrees.

## Supabase schema changes

When a code change adds, removes, or renames Supabase database fields, tables,
RPC return columns, triggers, policies, or Edge Function database contracts:

1. Add or update the migration in `supabase/migrations/`.
2. Run the normal verification commands for the repo.
3. Run `supabase db push` before handing the work back.
4. If `supabase db push` cannot be run, report the exact blocker and do not
   describe the product as ready to run against the remote database.

Do not add long-term fallback code for old schemas unless the user explicitly
asks for backwards compatibility. The MVP assumes code and Supabase schema move
together.
