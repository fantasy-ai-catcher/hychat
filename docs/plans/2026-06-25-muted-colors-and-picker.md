# Muted profile colors + interactive color picker

Date: 2026-06-25
Branch: `feature/color-picker` (to be created)

## Motivation

Two friend-reported issues with profile colors:
1. The current palette is too vivid — 20 Tailwind-500 colors (`#ef4444` etc.)
   are neon on a dark terminal.
2. Changing color requires typing `/color set <name>`. Friends want to pick
   interactively (like Claude Code's option picker): `/color list` should show
   every color and let you move with the arrow keys and press Enter to select.

## Decisions (from brainstorming)

- **Replace the palette with a curated muted set** (not darken-in-place).
- **`/color list` becomes an interactive grid picker** (↑↓←→, Enter select,
  Esc cancel); names render in their own color; the selected cell is highlighted.
- **Keep `/color set <name>`** as a direct command alongside the picker.
- **No backward-compat aliases.** Old saved color names (red/blue/…) are not in
  the new palette, so they resolve to the default (white); everyone re-picks
  from the new palette. Acceptable for a few friends and is the point.

## Part A — Muted palette (`src/app/profile-colors.ts`)

Replace `PROFILE_COLORS` with ~13 low-saturation, mid-lightness colors. Starting
values (final values to be tuned in a real terminal — hex is only a start):

| name | hex | | name | hex |
| --- | --- | --- | --- | --- |
| slate | `#8896a6` | | clay | `#bd8a6a` |
| steel | `#6f8fb0` | | rose | `#c08497` |
| teal | `#5e9b9b` | | mauve | `#a18fb0` |
| sage | `#8aa37b` | | plum | `#8c7aa0` |
| moss | `#6f8f5f` | | dusk | `#7c83b0` |
| olive | `#9a9b5f` | | gray | `#9ca3af` |
| sand | `#c2a36b` | | | |

- `DEFAULT_PROFILE_COLOR = 'white'` stays.
- `isProfileColorName`, `resolveProfileColor`, `formatProfileColorList` keep
  their signatures (still used by `/color set`, `/color` show, error text).
- Unknown/old names resolve to the default via the existing fallback — no code
  change needed for the reset behavior.

## Part B — Interactive grid picker

### B1. Pure picker logic — `src/ui/color-picker.ts` (Layer 1, strict TDD)

The grid navigation math is pure and is the spec:

```ts
export type PickerCell = { name: string; value: string }; // value = resolved hex or 'white'
export type PickerDirection = 'up' | 'down' | 'left' | 'right';

// Columns by terminal width, matching the member-grid responsiveness style.
export function colorPickerColumns(terminalWidth: number): number; // >=100 -> 4, >=70 -> 3, else 2

// Row-major move with clamping at edges (no wrap-around — predictable).
// index stays within [0, cells.length-1]; moving past an edge is a no-op.
export function movePickerSelection(
  index: number, direction: PickerDirection, cellCount: number, columns: number
): number;

// Row-major split for rendering.
export function pickerGridRows<T>(cells: T[], columns: number): T[][];
```

- Cells = a leading `default` cell (resets to `DEFAULT_PROFILE_COLOR`) followed by
  every `PROFILE_COLORS` entry.
- Clamp semantics (tested), one rule: a move computes the target cell one grid
  step away; if that cell does not exist (past an edge, or an empty trailing slot
  in the last row), the move is a no-op and the index is unchanged. So: right at
  row end = no-op; left at col 0 = no-op; up from row 0 = no-op; down when no
  cell sits directly below (last/short row) = no-op.

### B2. Session wiring — `src/app/chat-session.ts`

- Add ephemeral session state `colorPickerOpen: boolean` (in `ChatSessionSnapshot`).
- `/color list` (the existing `color-list` command) now sets `colorPickerOpen = true`
  instead of printing the text list. (`/color` with no args still prints the
  current color + palette text; `/color set <name>` unchanged.)
- Add `pickColor(name: string)`: reuse the `color-set` logic
  (`updateProfileColor` + `member-color-changed` apply), then set
  `colorPickerOpen = false`. Validates against `isProfileColorName`.
- Add `closeColorPicker()`: sets `colorPickerOpen = false`, no color change.

### B3. UI — `src/ui/App.tsx` (Layer 2, thin)

- When `snapshot.colorPickerOpen` is true:
  - Render a bordered picker panel (in place of the input composer) listing all
    cells via `pickerGridRows`; each name rendered with `resolveProfileColor`;
    the highlighted cell shows a `▸` + bold/inverse.
  - Keep the highlight index in local `useState`, initialized to the current
    color's cell when the picker opens (effect on the open transition).
  - In `useInput`, BEFORE the composer/scroll branches: if the picker is open,
    route ↑↓←→ to `movePickerSelection`, Enter to `session.pickColor(currentName)`,
    Esc to `session.closeColorPicker()`, and `return` (so keys never reach the
    composer). Ctrl+C still exits.
- When closed, the composer renders as normal.

## Testing strategy (per CLAUDE.md layers)

- **Layer 1 (strict TDD):**
  - `color-picker.ts`: `colorPickerColumns`, `movePickerSelection` (every edge:
    right at row end, down from last/short row, left at col 0, up from row 0,
    normal moves), `pickerGridRows`.
  - `profile-colors`: update existing tests for the new names; assert
    `resolveProfileColor('red')` (old name) now falls back to default.
- **Layer 2 (test-after, minimal):** with `colorPickerOpen` true, the rendered
  picker content includes every color name. Do not assert layout/positions.
- **Smoke (`pnpm dev`):** `/color list` opens the picker; arrow keys move the
  highlight; Enter applies and the member panel + own name recolor; Esc cancels;
  `/color set sage` still works; an old saved color now shows as default.

## Out of scope

- Per-room colors, custom hex entry, themes.
- Mouse selection in the picker (keyboard only).
- Backward-compat aliases for old color names.

## Docs to update in the same change

- `CHANGELOG.md` (Changed): muted palette + interactive `/color list` picker;
  note old colors reset and need re-picking.
- `docs/CODE_MAP.md`: new `src/ui/color-picker.ts`; update the `profile-colors.ts`
  and `chat/commands.ts` / `chat-session.ts` notes for the picker.
