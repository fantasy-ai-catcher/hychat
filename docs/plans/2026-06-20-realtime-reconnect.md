# Realtime channel gets stuck "connecting" and never recovers

## Problem

Two clients in the same room both think the other is offline, and one stops
receiving the other's messages. Symptom on the affected client: the header/
status bar is stuck on **connecting**.

## Root cause

All live updates ride one realtime channel (`room:<id>:updates`): message
`postgres_changes`, presence sync, and the typing/focus/quote broadcasts. The
status callback in `subscribeToRoomRealtime` does only one thing — relabel the
UI:

```ts
channel.subscribe((status) => {
  options.onStatus?.(status);
  if (status === 'SUBSCRIBED' && options.userId) channel.track(...);
});
```

There is **no recovery**. If the channel drops into `CHANNEL_ERROR` or
`TIMED_OUT` mid-session (network blip, auth-token refresh race, server idle
timeout), it never rejoins. That single dead channel explains all three
symptoms at once:

- no `postgres_changes` delivery → the client stops receiving messages;
- no presence sync → it sees everyone as offline;
- it never re-`track()`s itself → others see *it* as offline.

Sending still works because that path is an insert/RPC, not the channel — hence
"can send, can't receive".

## Fix

Make the subscription self-heal (Direction: auto-reconnect).

- `subscribeToRoomRealtime`: when the status callback reports `CHANNEL_ERROR` or
  `TIMED_OUT`, tear down the dead channel and rebuild it after a backoff, then
  re-`track()` presence on the fresh `SUBSCRIBED`. Reset the backoff on success.
  Cancel any pending retry when the caller unsubscribes (don't reconnect a
  channel we intentionally closed).
- `reconnectDelayMs(attempt)`: pure exponential backoff (1s → 30s cap),
  unit-tested in isolation (Layer 1).

## Test strategy

- `reconnectDelayMs`: strict Layer-1 unit test.
- Reconnect orchestration (timers / dispose / re-track): a couple of focused
  tests driving the status callback with fake timers — this exercises *our*
  control flow, not Supabase's schema, so it stays within the spirit of the
  Layer-3 rule. Real confirmation is a `pnpm dev:tmux` smoke run: kill one
  client's network briefly and watch it return to `connected` + presence.

## Out of scope

- No change to how presence/messages are modelled; only recovery is added.
