# Header panel: stock codes, members grid, toggles

## Goal

Improve the top info panel (`src/ui/App.tsx` `TopInfoPanel`):

1. **Stocks** — show each row's symbol code (e.g. `7709.HK`) as a dim column
   to the right of the name, before price/percent.
2. **Members** — render members in a 1/2/3-column grid chosen by terminal
   width, on their own lines below a `Members` label (not crammed onto the
   title line). Show all members, no `+N more` cap.
3. **Toggles** — `Ctrl+S` shows/hides the Stocks section, `Ctrl+P` shows/hides
   the Members section. (`Ctrl+M` is impossible: same byte as Enter.)

## Design

- **Layer 1 (pure):**
  - `src/stocks/format.ts`: add `symbol` to `WatchlistRow` and `symbolWidth`
    to `WatchlistTable` (display-width of the code column).
  - `src/ui/state.ts`: `memberGridColumns(terminalWidth, memberCount)` →
    `1 | 2 | 3` (thresholds: ≥120 → 3, ≥80 → 2, else 1; clamped to count),
    and `layoutMemberGrid(members, terminalWidth)` → row-major rows.
  - `src/ui/App.tsx`: `resolveTopPanelToggle(value, key)` →
    `'stocks' | 'members' | undefined` (Ctrl+S / Ctrl+P), tested like
    `resolveEditorAction`.
- **Layer 2 (Ink, thin):** `TopInfoPanel` renders the grid + symbol column and
  honors `showStocks` / `showMembers` props; `AppShell` threads the flags +
  terminal width and recomputes `topPanelHeight` from member rows + visibility.
- **State:** visibility is local UI state in `App` (`useState`, default on);
  `useInput` flips it via `resolveTopPanelToggle`.

## Verify

- `pnpm typecheck`, `pnpm test` (new pure tests + updated render tests).
- Smoke run (`pnpm dev`): confirm grid reflow, symbol column, and that Ctrl+S /
  Ctrl+P toggle without Ctrl+S freezing output (raw mode clears IXON).
