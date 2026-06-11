# Command loading feedback

## Problem

Submitting a slow command (`/start`, `/create`, `/join`, …) gives no feedback
until the Supabase request finishes: `App.tsx` only updates the snapshot after
`session.handleLine()` resolves, so the status line stays on the previous text
for the whole round-trip (OTP email send can take seconds).

## Approach

`createChatSession` already has an `onSnapshotChange` callback wired to
`setSnapshot` in `App.tsx` (used by realtime pushes). Reuse it: when
`handleLine` parses a command that does IO, immediately set `statusText` to a
short pending message (e.g. `Signing in…`, `Creating room Friends…`) and emit
a snapshot before executing the command. The final status overwrites it when
the command completes or fails. No UI component changes, no new dependencies.

## Changes

- `src/app/chat-session.ts` (Layer 1, TDD):
  - New exported pure function `buildPendingStatusText(parsed): string | null`
    mapping each parsed input to a pending message, or `null` for inputs that
    resolve instantly (`/help`, `/quit`, unconfirmed `/logout`, `/color`,
    `/color list`, bare `/start`, parse errors, empty input).
  - `handleLine`: if the pending text is non-null, set `statusText` and call
    `emitSnapshotChange()` before running the command.

## Follow-up: animated spinner + shimmer (same branch)

The static pending text works but the user wants motion, like Claude Code:
a spinner that keeps turning and a highlight sweeping across the pending text.

- `src/app/chat-session.ts`: add `isBusy: boolean` to the snapshot so the UI
  can tell a pending status from a final one. Set it true alongside the
  pending status text, false when the command settles.
- `src/ui/loading-animation.ts` (new, Layer 1 TDD): pure frame logic —
  `spinnerFrame(tick)` cycling braille frames, and
  `buildShimmerSegments(text, tick)` returning `{ text, bright }` segments
  with a highlight window that sweeps across the text and wraps around.
- `src/ui/App.tsx` (Layer 2, thin): an ~80ms interval ticks only while
  `isBusy`; `StatusText` renders `spinner + shimmered text` for the first
  line when busy. No new dependencies.

## Verification

- New unit tests for `buildPendingStatusText` and for the interim snapshot
  emitted by `handleLine` while a service call is still pending.
- `pnpm typecheck` + `pnpm test`.
- Smoke run `pnpm dev`: run `/start <email>` and observe the pending status
  appear before the "Code sent" message.
