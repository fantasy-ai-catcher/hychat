# Welcome screen for the no-room empty state

## Problem

Before the user runs `/start` (or after starting but before joining a room),
the TUI renders the full in-room layout: the top Members/Stocks panel, the
"No messages" viewport, and the bottom status bar are all placeholder dashes.
The screen is full of meaningless `-` and the only actionable hint is one dim
status line.

## Direction (agreed with user)

Replace the empty state with a welcome screen: when there is no active room,
hide the top info panel and the bottom status bar, and render onboarding
content in the main area (title + getting-started steps + `/help` hint). Keep
the status text line (command feedback such as `/rooms` output still renders
there) and the input composer.

## Design

### Layer 1 — pure logic in `src/ui/state.ts` (TDD)

- `type ShellView = 'welcome' | 'chat'`
- `resolveShellView(state)` → `'welcome'` when `activeRoomId` is unset,
  `'chat'` otherwise.
- `buildWelcomeLines(userDisplayName?)` → onboarding lines:
  - not started: numbered steps `/start` → `/rooms` → `/join`, then `/help`
    hint.
  - started but no room: greet by nickname, suggest `/rooms`,
    `/create-room`, `/join`, then `/help` hint.

### Layer 2 — `src/ui/App.tsx` (test-after, minimal)

- New `WelcomeScreen` component: bold `HyChat` title + lines from
  `buildWelcomeLines`, fills the space previously used by the top panel +
  message viewport.
- `AppShell` branches on `resolveShellView`: welcome view renders
  `WelcomeScreen` + `StatusText` + `InputComposer` (no `TopInfoPanel`, no
  `StatusBar`); chat view is unchanged.
- Update the existing AppShell test that asserted the dash-filled top panel
  for the no-room state; add minimal render tests for the welcome view.

## Verification

- `pnpm typecheck`, `pnpm test`.
- Smoke run `pnpm dev`: check welcome screen before `/start`, after `/start`
  without a room, and that joining a room restores the chat layout.
