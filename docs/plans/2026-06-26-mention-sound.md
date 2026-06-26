# Mention sound notifications

## Goal

Play a sound (and optionally a desktop banner) when an incoming message
@mentions me. User-selectable, persisted locally per machine. Default: terminal
bell, only when the HyChat window is unfocused.

## Decisions (agreed with user)

- Default channel: **terminal bell** (`\x07`). Channels also offered:
  `sound` (macOS `afplay`), `banner` (OSC 9 iTerm2 / OSC 777 Ghostty, falls
  back to bell), and `off`.
- Default timing: **only when unfocused** (don't beep while I'm reading). Also
  switchable to `always`.
- Preference is local (each friend's own machine) — stored in `prefs.json`
  next to `session.json`, NOT in Supabase.
- Switch via `/notify` command. No Supabase/schema change.

## Layers

**L1 pure — `src/app/mention-notify.ts`** (strict TDD)
- `NotifyChannel = 'off' | 'bell' | 'sound' | 'banner'`,
  `NotifyWhen = 'always' | 'unfocused'`, `NotifySettings`.
- `DEFAULT_NOTIFY_SETTINGS = { channel: 'bell', when: 'unfocused' }`.
- `shouldRingForMention({ kind, body, senderId, selfUserId, selfName, focused, settings })`
  → false if: channel off / not a text message / no selfName / sender is me /
  body doesn't mention me / (when=unfocused AND focused). Else true.
- `readNotifySettings(get)` / `writeNotifySettings(set, s)` — clamp invalid to
  defaults. Keys `notify.channel`, `notify.when`.
- `isNotifyChannel`, `isNotifyWhen`, `describeNotifySettings`.

**L1 sequences + thin shell — `src/app/notify-sound.ts`**
- Pure: `BELL`, `iterm2NotifySequence(msg)`, `ghosttyNotifySequence(title,msg)`,
  `detectTerminalProgram(env)`, `bannerSequence(env,title,msg)`.
- Shell: `createTerminalNotifier({ stdout, spawn, env, platform })` →
  `ring(channel, message)`: bell→write BELL; banner→write bannerSequence;
  sound→`afplay Glass.aiff` on darwin else BELL; off→noop.

**L1 command parsing — `src/chat/commands.ts`**
- `/notify` (show), `/notify off|bell|sound|banner`, `/notify when always|unfocused`,
  `/notify test`. Invalid → usage error.

**Wiring (imperative shell, no mock-TDD)**
- `session-storage.ts`: `getDefaultPreferencesPath` / `getProfilePreferencesPath`.
- `cli.ts`: build a `JsonFileStorage` prefs + `createTerminalNotifier`, pass to App.
- `App.tsx`: thread `notifier` + `prefs` props into `createChatSession`.
- `chat-session.ts`: load settings at init; in `onMessage` call ring when
  `shouldRingForMention`; handle `/notify` command; expose `notifySettings` in
  snapshot. Defaults to a no-op notifier + default settings when omitted (tests).

## Verify

- `pnpm typecheck` + `pnpm test` green.
- Smoke: two `--profile` clients; `/notify test` rings; @mention from the other
  client rings only when window unfocused; `/notify sound` plays afplay ding;
  `/notify off` silent.

## Out of scope

- Cross-room mentions (only the active room is subscribed) — note in status.
- Interactive picker overlay (text subcommands are enough).
