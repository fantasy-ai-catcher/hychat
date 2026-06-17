# Input box editing: cursor movement, readline shortcuts, multiline

## Problem

The composer in `src/ui/App.tsx` keeps `input` as a plain string and only
supports appending a character and deleting the last one (`slice(0, -1)`).
There is no cursor position, so you cannot move the caret, edit mid-string,
clear the whole line, move/delete by word, or insert newlines.

## Goal

Make the input behave like a normal terminal text field, using readline/Emacs
conventions (Cmd is not reportable by terminals, so Ctrl/Option stand in):

- Move cursor: ←/→, Ctrl+A (line start), Ctrl+E (line end), Option+←/→ (by word),
  ↑/↓ (between lines), Home/End.
- Delete: Backspace/Delete (char before cursor), Ctrl+W (word before cursor),
  Ctrl+U (kill to line start — clears a single line, the Cmd+A replacement),
  Ctrl+K (kill to line end).
- Newline: Shift+Tab inserts `\n`. Enter still submits the whole buffer.
- Insert (incl. paste of multi-char / multi-line text) at the cursor.

### macOS Backspace vs Delete

The Mac "delete" key sends DEL (0x7f), which Ink reports as `key.delete`;
`key.backspace` is actually Ctrl+H. Forward-delete (Fn+Delete / `[3~`) is also
named `delete`. We can't reliably tell them apart, so both `key.backspace` and
`key.delete` map to "delete char before cursor" (= today's behavior). No
separate forward-delete binding.

## Design (layered)

**Layer 1 — `src/ui/input-editor.ts` (pure, strict TDD).**
`InputBuffer = { value: string; cursor: number }` (cursor is a code-point index,
so emoji don't split). `applyEditorAction(buffer, action)` is a pure reducer over
actions: `insert`, `newline`, `backspace`, `deleteForward`, `deleteWordBack`,
`killToLineStart`, `killToLineEnd`, `moveLeft`, `moveRight`, `moveWordLeft`,
`moveWordRight`, `moveLineStart`, `moveLineEnd`, `moveUp`, `moveDown`, `clear`.
Line-aware ops operate on the visual line around the cursor (split on `\n`);
up/down keep the column. Word = run of non-whitespace. New test file
`src/ui/input-editor.test.ts` covers each action incl. multiline edges.

**Layer 2 — `src/ui/App.tsx` + `InputComposer` (thin).**
- App holds `buffer` state, maps each key to one action, calls the reducer.
  Enter submits `buffer.value` then resets; typing-presence notify keeps working.
- `InputComposer` renders the value as one `<Text>` per line (prompt `>` on the
  first line, 2-space indent on continuations) and draws a block cursor
  (`<Text inverse>` over the char under the caret, or a trailing block at EOL),
  blinking via `cursorVisible`.
- `AppShell` takes `value`/`cursor` instead of `input`, and grows the bottom
  region by the input line count so multiline input shrinks the chat viewport
  instead of overflowing: `bottomHeight = statusHeight + 3 + inputLineCount`.

## Verify

- `pnpm typecheck` + `pnpm test` (Layer 1 specs + updated App/InputComposer tests).
- Smoke run (`pnpm dev`, or dev:tmux) since it changes TUI rendering: type,
  move the caret, Option+arrows, Ctrl+A/E/U/K/W, Shift+Tab multiline, send.
