# Background refresh network errors should not crash the app

## Problem

A transient `TypeError: fetch failed` during a fire-and-forget background
refresh crashes the whole TUI to the Node prompt. Repro from the field: a
realtime `onWatchlistChange` (a friend added several stocks) triggered
`reloadRoomThenRefreshQuotes` → `loadRoomSnapshot` → `listMembers`, the fetch
failed at the transport layer, and because the call is `void ...` with no
`.catch`, it became an unhandled rejection and Node 26 exited the process.

The raw stack trace was dumped onto the user's chat UI.

## Goal

Background refreshes must never crash the app and never surface a raw error.
On failure, keep the existing snapshot and show a friendly status hint.

## Changes (src/app/chat-session.ts)

1. Add a `runBackground(task)` helper: runs a promise-returning task
   fire-and-forget, and on any rejection swallows it, sets a friendly
   `statusText`, and emits a snapshot. The next realtime event retries.
   Used for the realtime-triggered reloads and off-critical-path quote
   refreshes that are currently bare `void ...` calls:
   - `onWatchlistChange` → `reloadRoomThenRefreshQuotes`
   - `onMembersChange` → `loadMembers().then(emitSnapshotChange)`
   - `joinRoom` off-critical-path `refreshQuotes`
   - the inner `refreshQuotes` inside `reloadRoomThenRefreshQuotes`

2. Map network-layer failures to a friendly message in
   `translateServiceError` so the **foreground** command path (`/watch`,
   `/join`, …) also shows "Network error — check your connection and try
   again." instead of raw `TypeError: fetch failed`.

## Tests (Layer 1, strict)

- Realtime `onWatchlistChange`/`onMembersChange` whose service rejects:
  session does not throw, status shows the network hint, prior snapshot kept.
- `translateServiceError('TypeError: fetch failed')` → friendly message.

## Verify

`pnpm typecheck`, `pnpm test`. Smoke run optional (no schema/render change).
