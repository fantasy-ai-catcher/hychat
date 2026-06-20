# Chat scrollback: mouse wheel + keyboard paging (option B)

## Problem

The chat log can't be scrolled. `MessageViewport` only ever renders
`messages.slice(-chatHeight)` inside an `overflow="hidden"` box, so older
messages are simply dropped and there is no way to see history. Native terminal
scrollback is useless because the app owns a full-height live region that it
repaints every frame.

## Decision

Keep the top info panel pinned (full-screen TUI), and implement scrolling
in-app:

- **Mouse wheel** via xterm mouse reporting (DECSET 1000 + SGR 1006), mirroring
  the existing `terminal-focus.ts` (DECSET 1004) pattern.
- **Keyboard paging** with PageUp / PageDown.
- Sending a message (Enter) or switching rooms jumps back to the latest.

Tradeoff accepted: while mouse reporting is on, native mouse text-selection is
captured; users hold Option (iTerm2/Ghostty) or Shift to select/copy. We do NOT
implement an in-app copy mode.

Also requested: collapse the two panel toggles into a single **Ctrl+S** that
shows/hides the whole top panel, and remove Ctrl+P.

## Approach (functional core / imperative shell)

### Layer 1 — pure logic (strict TDD)

`src/ui/scroll.ts`
- `buildRenderLines(messages, innerWidth, showTimestamps)` → flat `RenderLine[]`,
  one entry per terminal row. Wraps each message to the terminal width by
  display width (CJK-aware via `string-width`), so the viewport never relies on
  Ink's own wrapping for height accounting. Chat lines carry the sender label +
  color on the first wrapped row only; system/activity lines carry centered dim
  text; the timestamp prefix (when on) sits on the first row.
- `sliceWindow(lines, viewportHeight, offset)` → the visible slice anchored
  `offset` lines up from the bottom, plus the clamped offset and `maxOffset`.

`src/ui/terminal-mouse.ts`
- `parseMouseScroll(chunk)` → `'up' | 'down' | null` (SGR wheel buttons 64/65).
- `isMouseSequence(chunk)` → drop wheel bytes before they reach the composer.
- `watchTerminalMouse(onScroll, streams)` → enable reporting, listen, return a
  cleanup that disables it (same shape as `watchTerminalFocus`).

### Layer 2 — Ink wiring (thin)

`src/ui/App.tsx`
- `scrollOffset` state in `App`; wheel (±3) and PageUp/PageDown (±page) adjust
  it; Enter and room change reset to 0. `AppShell` reports `maxOffset` up via a
  callback so `App` can clamp.
- `MessageViewport` takes `messages` + `width` + `scrollOffset`; internally
  builds render lines and slices the window. Existing message-based render tests
  keep working.
- A "scrolled up" hint in the status bar (PageDown / Enter to jump to latest).
- Replace `showStocks`/`showMembers` with one `showPanel`; Ctrl+S toggles it,
  Ctrl+P removed. `resolveTopPanelToggle` → `isPanelToggle`.

## Verification

- `pnpm typecheck` + `pnpm test` (new Layer-1 tests for scroll + mouse; updated
  App tests for the toggle change).
- Smoke run (`pnpm dev`) — confirm wheel + PageUp/PageDown scroll history, Enter
  jumps to bottom, Ctrl+S hides/shows the panel, and copy works with Option held.

## Known limitation (v1)

Scroll offset is anchored from the bottom: while scrolled up, a newly arrived
message shifts the view up by its height instead of holding the read position
perfectly. Acceptable for a few friends; revisit if it annoys.
