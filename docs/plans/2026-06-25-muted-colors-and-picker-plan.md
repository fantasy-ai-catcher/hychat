# Muted Colors + Interactive Color Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vivid profile-color palette with a muted set, and make `/color list` an interactive arrow-key grid picker (Enter to select, Esc to cancel) while keeping `/color set <name>`.

**Architecture:** Grid navigation is a pure module (`src/ui/color-picker.ts`, Layer 1 TDD). The session gains a `colorPickerOpen` flag plus `pickColor`/`closeColorPicker` methods; `/color list` flips the flag instead of printing text. `App.tsx` renders a `ColorPicker` panel when open and routes arrow/Enter/Esc keys to it (Layer 2, thin).

**Tech Stack:** TypeScript, Ink (React for terminal), vitest. Spec: `docs/plans/2026-06-25-muted-colors-and-picker.md`.

**Branch:** `feature/color-picker` (already created; spec committed; main merged in).

**Run tests with:** `corepack pnpm exec vitest run <path>` and `corepack pnpm typecheck` (this machine runs pnpm via corepack).

---

## File Structure

- **Modify** `src/app/profile-colors.ts` — replace `PROFILE_COLORS` with the muted set. Public functions unchanged.
- **Modify** `src/app/profile-colors.test.ts` — update count/name assertions; assert old names fall back to default.
- **Create** `src/ui/color-picker.ts` — pure grid logic: `pickerColorNames`, `colorPickerColumns`, `movePickerSelection`, `pickerGridRows`.
- **Create** `src/ui/color-picker.test.ts` — Layer 1 tests for the above.
- **Modify** `src/app/chat-session.ts` — `colorPickerOpen` in snapshot + state; `/color list` opens it; `pickColor`/`closeColorPicker`; factor an `applyColor` helper.
- **Modify** `src/app/chat-session.test.ts` — `/color list` opens picker; `pickColor` sets color + closes; `closeColorPicker` closes.
- **Modify** `src/ui/App.tsx` — `ColorPicker` component + open-branch render + `pickerIndex` state + init effect + `useInput` routing.
- **Modify** `src/ui/App.test.tsx` — picker content render test (no layout asserts).
- **Modify** `CHANGELOG.md`, `docs/CODE_MAP.md`.

---

## Task 1: Muted palette

**Files:**
- Modify: `src/app/profile-colors.ts:3-24`
- Test: `src/app/profile-colors.test.ts`

- [ ] **Step 1: Update the tests first**

Replace the first two `it(...)` blocks in `src/app/profile-colors.test.ts` with:

```ts
  it('offers exactly 13 muted selectable colors plus the white default', () => {
    expect(DEFAULT_PROFILE_COLOR).toBe('white');
    expect(PROFILE_COLORS).toHaveLength(13);
    expect(PROFILE_COLORS.map((color) => color.name)).toContain('sage');
    expect(PROFILE_COLORS.map((color) => color.name)).not.toContain('white');
    // The old vivid names are gone; their saved values resolve to the default.
    expect(PROFILE_COLORS.map((color) => color.name)).not.toContain('red');
  });

  it('validates color names and resolves terminal color values', () => {
    expect(isProfileColorName('sage')).toBe(true);
    expect(isProfileColorName('white')).toBe(true);
    expect(isProfileColorName('red')).toBe(false); // old name no longer valid
    expect(resolveProfileColor('sage')).toMatch(/^#/);
    expect(resolveProfileColor('red')).toBe('white'); // old saved color -> default
    expect(resolveProfileColor(undefined)).toBe('white');
  });
```

Then update the third test (`formats the selectable colors…`) to:

```ts
  it('formats the selectable colors for the color command', () => {
    expect(formatProfileColorList()).toContain('1:slate');
    expect(formatProfileColorList()).toContain('13:gray');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/profile-colors.test.ts`
Expected: FAIL (palette still has 20 vivid colors; `slate`/`sage` absent).

- [ ] **Step 3: Replace the palette**

In `src/app/profile-colors.ts`, replace the entire `PROFILE_COLORS` array (lines 3-24) with:

```ts
export const PROFILE_COLORS = [
  { name: 'slate', value: '#8896a6' },
  { name: 'steel', value: '#6f8fb0' },
  { name: 'teal', value: '#5e9b9b' },
  { name: 'sage', value: '#8aa37b' },
  { name: 'moss', value: '#6f8f5f' },
  { name: 'olive', value: '#9a9b5f' },
  { name: 'sand', value: '#c2a36b' },
  { name: 'clay', value: '#bd8a6a' },
  { name: 'rose', value: '#c08497' },
  { name: 'mauve', value: '#a18fb0' },
  { name: 'plum', value: '#8c7aa0' },
  { name: 'dusk', value: '#7c83b0' },
  { name: 'gray', value: '#9ca3af' }
] as const;
```

Leave `DEFAULT_PROFILE_COLOR`, `isProfileColorName`, `resolveProfileColor`, `formatProfileColorList` unchanged — the fallback in `resolveProfileColor` already turns unknown old names into the default.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/app/profile-colors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/profile-colors.ts src/app/profile-colors.test.ts
git commit -m "feat: replace vivid profile palette with a muted set"
```

---

## Task 2: Pure grid-picker logic

**Files:**
- Create: `src/ui/color-picker.ts`
- Test: `src/ui/color-picker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/color-picker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  colorPickerColumns,
  movePickerSelection,
  pickerColorNames,
  pickerGridRows
} from './color-picker.js';
import { DEFAULT_PROFILE_COLOR, PROFILE_COLORS } from '../app/profile-colors.js';

describe('pickerColorNames', () => {
  it('leads with the default, then every palette color', () => {
    const names = pickerColorNames();
    expect(names[0]).toBe(DEFAULT_PROFILE_COLOR);
    expect(names).toHaveLength(PROFILE_COLORS.length + 1);
    expect(names).toContain('sage');
  });
});

describe('colorPickerColumns', () => {
  it('picks columns by terminal width', () => {
    expect(colorPickerColumns(60)).toBe(2);
    expect(colorPickerColumns(70)).toBe(3);
    expect(colorPickerColumns(99)).toBe(3);
    expect(colorPickerColumns(100)).toBe(4);
  });
});

describe('movePickerSelection', () => {
  // 7 cells, 3 columns ->
  //   row0: 0 1 2
  //   row1: 3 4 5
  //   row2: 6
  const count = 7;
  const cols = 3;

  it('moves within the grid', () => {
    expect(movePickerSelection(0, 'right', count, cols)).toBe(1);
    expect(movePickerSelection(1, 'left', count, cols)).toBe(0);
    expect(movePickerSelection(0, 'down', count, cols)).toBe(3);
    expect(movePickerSelection(3, 'up', count, cols)).toBe(0);
  });

  it('clamps at edges (no-op when the target cell does not exist)', () => {
    expect(movePickerSelection(2, 'right', count, cols)).toBe(2); // row end
    expect(movePickerSelection(0, 'left', count, cols)).toBe(0); // col 0
    expect(movePickerSelection(0, 'up', count, cols)).toBe(0); // row 0
    expect(movePickerSelection(6, 'down', count, cols)).toBe(6); // last row
    expect(movePickerSelection(5, 'down', count, cols)).toBe(5); // no cell below 5 (only 6 exists, col0)
    expect(movePickerSelection(6, 'right', count, cols)).toBe(6); // last cell, partial row
  });
});

describe('pickerGridRows', () => {
  it('splits row-major into rows of `columns`', () => {
    expect(pickerGridRows([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6]
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/ui/color-picker.test.ts`
Expected: FAIL — cannot resolve `./color-picker.js`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/color-picker.ts`:

```ts
import { DEFAULT_PROFILE_COLOR, PROFILE_COLORS } from '../app/profile-colors.js';

export type PickerDirection = 'up' | 'down' | 'left' | 'right';

// The pickable names: the default (resets to plain) first, then the palette.
export function pickerColorNames(): string[] {
  return [DEFAULT_PROFILE_COLOR, ...PROFILE_COLORS.map((color) => color.name)];
}

// Columns by terminal width, matching the member-grid responsiveness style.
export function colorPickerColumns(terminalWidth: number): number {
  return terminalWidth >= 100 ? 4 : terminalWidth >= 70 ? 3 : 2;
}

// Row-major move with clamping: compute the target one grid step away; if that
// cell does not exist (past an edge or an empty trailing slot), stay put.
export function movePickerSelection(
  index: number,
  direction: PickerDirection,
  count: number,
  columns: number
): number {
  const column = index % columns;
  switch (direction) {
    case 'left':
      return column > 0 ? index - 1 : index;
    case 'right':
      return column < columns - 1 && index + 1 < count ? index + 1 : index;
    case 'up':
      return index - columns >= 0 ? index - columns : index;
    case 'down':
      return index + columns < count ? index + columns : index;
  }
}

// Split a flat list row-major into rows of up to `columns` items.
export function pickerGridRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/ui/color-picker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/color-picker.ts src/ui/color-picker.test.ts
git commit -m "feat: add pure grid-navigation logic for the color picker"
```

---

## Task 3: Session — picker state + pick/close methods

**Files:**
- Modify: `src/app/chat-session.ts` (snapshot type ~120-127; state ~328-330; `color-list` handler ~893-896; `color-set` handler ~898-910; returned object ~926+)
- Test: `src/app/chat-session.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these to `src/app/chat-session.test.ts` (inside the top-level `describe('createChatSession', …)` block; `createService`/`signIn` helpers already exist there — reuse them as the other tests do):

```ts
  it('opens the color picker on /color list instead of printing the palette', async () => {
    const { service } = createService();
    const session = createChatSession({ service });
    await signIn(session);

    const snapshot = await session.handleLine('/color list');
    expect(snapshot.colorPickerOpen).toBe(true);
  });

  it('pickColor sets the color, updates the panel, and closes the picker', async () => {
    const { service, updateProfileColor } = createService();
    let latest: Awaited<ReturnType<typeof session.handleLine>> | undefined;
    const session = createChatSession({ service, onSnapshotChange: (s) => { latest = s; } });
    await signIn(session);
    await session.handleLine('/color list');

    await session.pickColor('sage');

    expect(updateProfileColor).toHaveBeenCalledWith('sage');
    expect(latest?.colorPickerOpen).toBe(false);
    expect(latest?.user?.displayColor).toBe('sage');
  });

  it('closeColorPicker closes without changing the color', async () => {
    const { service, updateProfileColor } = createService();
    let latest: Awaited<ReturnType<typeof session.handleLine>> | undefined;
    const session = createChatSession({ service, onSnapshotChange: (s) => { latest = s; } });
    await signIn(session);
    await session.handleLine('/color list');

    session.closeColorPicker();

    expect(updateProfileColor).not.toHaveBeenCalled();
    expect(latest?.colorPickerOpen).toBe(false);
  });
```

Note: confirm `createService()` returns the `updateProfileColor` mock (it is wired as `service.updateProfileColor`). If the helper does not already expose it by name, read the mock from `service.updateProfileColor` instead:
`const updateProfileColor = service.updateProfileColor as ReturnType<typeof vi.fn>;`
and drop the destructured form. Also confirm the mock resolves to a user whose `displayColor` echoes the argument; if it returns a fixed user, assert `updateProfileColor` was called with `'sage'` only.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/chat-session.test.ts`
Expected: FAIL — `colorPickerOpen`/`pickColor`/`closeColorPicker` do not exist.

- [ ] **Step 3: Add `colorPickerOpen` to the snapshot type**

In `src/app/chat-session.ts`, change the `ChatSessionSnapshot` type to add the field:

```ts
export type ChatSessionSnapshot = {
  state: AppState;
  user: HychatUser | null;
  statusText: string;
  isBusy: boolean;
  helpLines: string[];
  shouldExit: boolean;
  colorPickerOpen: boolean;
};
```

- [ ] **Step 4: Add the state var and include it in `snapshot()`**

Near `let shouldExit = false;` (~line 330) add:

```ts
  let colorPickerOpen = false;
```

Change `snapshot()` (~line 374) to:

```ts
  function snapshot(): ChatSessionSnapshot {
    return { state, user, statusText, isBusy, helpLines, shouldExit, colorPickerOpen };
  }
```

- [ ] **Step 5: Factor an `applyColor` helper and reuse it in `color-set`**

Add this helper function inside `createChatSession` (place it near the other inner helpers, e.g. just below `requireUser`):

```ts
  // Persist a profile color, reflect it in the member panel immediately, and
  // report the result. Shared by `/color set` and the picker's pickColor.
  async function applyColor(name: string): Promise<{ ok: boolean }> {
    if (!isProfileColorName(name)) {
      return { ok: false };
    }
    user = await options.service.updateProfileColor(name);
    apply({ type: 'member-color-changed', userId: user.id, color: user.displayColor });
    return { ok: true };
  }
```

Then replace the `color-set` handler body (~898-910) with:

```ts
      case 'color-set': {
        requireUser();
        const result = await applyColor(command.color);
        if (!result.ok) {
          statusText = `Unknown color: ${command.color}\n${formatProfileColorList()}`;
          return;
        }
        statusText = `Color set to ${user?.displayColor}.`;
        return;
      }
```

- [ ] **Step 6: Make `/color list` open the picker**

Replace the `color-list` handler (~893-896) with:

```ts
      case 'color-list':
        requireUser();
        colorPickerOpen = true;
        return;
```

- [ ] **Step 7: Add `pickColor` and `closeColorPicker` to the returned object**

In the object returned by `createChatSession` (after `notifyFocus`, before `handleLine`), add:

```ts
    // Apply a color chosen in the interactive picker, then close it.
    async pickColor(name: string): Promise<void> {
      await applyColor(name);
      colorPickerOpen = false;
      emitSnapshotChange();
    },

    // Dismiss the interactive picker without changing the color.
    closeColorPicker(): void {
      colorPickerOpen = false;
      emitSnapshotChange();
    },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/app/chat-session.test.ts`
Expected: PASS. (If a pre-existing test asserted the old `/color list` text output, update it to assert `colorPickerOpen === true`.)

- [ ] **Step 9: Commit**

```bash
git add src/app/chat-session.ts src/app/chat-session.test.ts
git commit -m "feat: session state + methods for the interactive color picker"
```

---

## Task 4: App — render the picker and route keys

**Files:**
- Modify: `src/ui/App.tsx` (imports; `useInput` ~192-258; picker render branch ~before line 264; new `ColorPicker` component)
- Test: `src/ui/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/App.test.tsx` (it imports `collectText`, `TopInfoPanel`, etc.; add `ColorPicker` to the import from `./App.js`):

```ts
  it('renders every pickable color name in the picker', () => {
    const text = collectText(
      ColorPicker({ index: 0, terminalWidth: 100, currentColor: 'white' })
    );
    expect(text).toContain('default'); // the leading default cell
    expect(text).toContain('sage');
    expect(text).toContain('gray');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run src/ui/App.test.tsx`
Expected: FAIL — `ColorPicker` is not exported.

- [ ] **Step 3: Add imports to `App.tsx`**

At the top of `src/ui/App.tsx`, alongside the existing imports, add:

```ts
import {
  colorPickerColumns,
  movePickerSelection,
  pickerColorNames,
  pickerGridRows,
  type PickerDirection
} from './color-picker.js';
import { DEFAULT_PROFILE_COLOR, resolveProfileColor } from '../app/profile-colors.js';
```

(If `resolveProfileColor` is already imported, do not duplicate it — extend the existing import.)

- [ ] **Step 4: Add the `ColorPicker` component**

Add near `TopInfoPanel` / `memberDot` (a presentational component, exported for the test):

```ts
export type ColorPickerProps = {
  index: number;
  terminalWidth?: number;
  currentColor?: string;
};

export function ColorPicker({
  index,
  terminalWidth = process.stdout.columns ?? 80,
  currentColor
}: ColorPickerProps) {
  const names = pickerColorNames();
  const columns = colorPickerColumns(terminalWidth);
  const rows = pickerGridRows(
    names.map((name, cellIndex) => ({ name, cellIndex })),
    columns
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Pick a color</Text>
      <Text dimColor>↑↓←→ to move · Enter to select · Esc to cancel</Text>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {row.map((cell) => {
            const selected = cell.cellIndex === index;
            const isDefault = cell.name === DEFAULT_PROFILE_COLOR;
            const label = isDefault ? 'default' : cell.name;
            const current = cell.name === currentColor ? '*' : ' ';
            return (
              <Box key={cell.name} width={12} flexShrink={0}>
                <Text
                  color={isDefault ? undefined : resolveProfileColor(cell.name)}
                  inverse={selected}
                  bold={selected}
                >
                  {selected ? '▸' : ' '}
                  {current}
                  {label}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 5: Add picker state + open-transition init in `App`**

Inside `App` (with the other `useState`s, e.g. near `scrollOffset`), add:

```ts
  const [pickerIndex, setPickerIndex] = useState(0);
```

After the existing effects, add an effect that initializes the highlight to the current color when the picker opens:

```ts
  const colorPickerOpen = snapshot.colorPickerOpen;
  useEffect(() => {
    if (colorPickerOpen) {
      const names = pickerColorNames();
      const currentName = snapshot.user?.displayColor ?? DEFAULT_PROFILE_COLOR;
      const found = names.indexOf(currentName);
      setPickerIndex(found >= 0 ? found : 0);
    }
  }, [colorPickerOpen, snapshot.user?.displayColor]);
```

- [ ] **Step 6: Route keys to the picker (top of `useInput`)**

At the very start of the `useInput((value, key) => { … })` callback (before the existing Ctrl+C / Ctrl+T / composer branches), add:

```ts
    if (snapshot.colorPickerOpen) {
      if (key.ctrl && value === 'c') {
        exit();
        return;
      }
      if (key.escape) {
        session?.closeColorPicker();
        return;
      }
      if (key.return) {
        const names = pickerColorNames();
        void session?.pickColor(names[pickerIndex] ?? DEFAULT_PROFILE_COLOR);
        return;
      }
      const direction: PickerDirection | undefined = key.upArrow
        ? 'up'
        : key.downArrow
          ? 'down'
          : key.leftArrow
            ? 'left'
            : key.rightArrow
              ? 'right'
              : undefined;
      if (direction) {
        const count = pickerColorNames().length;
        const columns = colorPickerColumns(process.stdout.columns ?? 80);
        setPickerIndex((current) => movePickerSelection(current, direction, count, columns));
      }
      return; // picker swallows all other keys
    }
```

- [ ] **Step 7: Render the picker instead of the shell when open**

Just before the `if (snapshot.shouldExit) { return null; }` block (so shouldExit still wins), add:

```ts
  if (snapshot.colorPickerOpen) {
    return (
      <ColorPicker
        index={pickerIndex}
        terminalWidth={terminalColumns}
        currentColor={snapshot.user?.displayColor}
      />
    );
  }
```

(`terminalColumns` is already computed at `const terminalColumns = process.stdout.columns;`.)

- [ ] **Step 8: Run typecheck + the App test**

Run: `corepack pnpm typecheck && corepack pnpm exec vitest run src/ui/App.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat: render the interactive color picker and route arrow/Enter/Esc"
```

---

## Task 5: Docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/CODE_MAP.md`

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]`, add (create `### Changed` / `### Fixed` if missing):

```markdown
### Changed
- Profile colors are now a muted palette instead of the old vivid one. `/color
  list` is an interactive picker — move with the arrow keys, Enter to select,
  Esc to cancel — and `/color set <name>` still works. Previously saved colors
  reset to the default; re-pick from the new palette.

### Fixed
- `/quit` no longer leaves a stale "connecting…" panel in the terminal on exit;
  the UI is cleared before the process exits.
```

(The second bullet is the catch-up for the already-merged quit-frame fix.)

- [ ] **Step 2: CODE_MAP**

In `docs/CODE_MAP.md`, under `ui/`:
- Add a line for `color-picker.ts` — `[L1]` pure grid logic (`pickerColorNames`, `colorPickerColumns`, `movePickerSelection`, `pickerGridRows`).
- Update the `App.tsx` note to mention the `ColorPicker` overlay (opened by `/color list`, arrow/Enter/Esc).
Under `app/`:
- Update the `profile-colors.ts` note to "muted palette".
- Update the `chat-session.ts` note to mention `colorPickerOpen` + `pickColor`/`closeColorPicker`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/CODE_MAP.md
git commit -m "docs: changelog + code map for muted colors and color picker"
```

---

## Final Verification

- [ ] **Typecheck + full suite:** `corepack pnpm typecheck && corepack pnpm exec vitest run` → all pass.
- [ ] **Smoke run** (`corepack pnpm dev`, in a room):
  - `/color list` opens the grid picker; arrow keys move the highlight; the names render in their muted colors; Enter applies (your name + member panel recolor); Esc cancels.
  - `/color set sage` still works directly.
  - A friend whose old color was e.g. `red` now shows as the default until they re-pick.
  - Tune the 13 hex values in `profile-colors.ts` if any read too bright/dim in the real terminal.
- [ ] **Report honestly** what was test-verified vs smoke-verified.

## Self-Review Notes (author)

- **Spec coverage:** muted palette (Task 1), grid logic (Task 2), session flag + pick/close + keep `/color set` (Task 3), App picker render + key routing + `default` cell + arrow/Enter/Esc + Ctrl+C still exits (Task 4), docs incl. old-colors-reset note (Task 5), smoke incl. hex tuning (Final). All spec sections mapped.
- **Type consistency:** `pickerColorNames`, `colorPickerColumns`, `movePickerSelection(index,direction,count,columns)`, `pickerGridRows`, `PickerDirection`, `ColorPicker`/`ColorPickerProps`, snapshot `colorPickerOpen`, session `pickColor`/`closeColorPicker`, helper `applyColor` — used identically across tasks.
- **Ordering safety:** palette (1) and pure logic (2) land first; session (3) compiles independently; App (4) consumes 2+3; every task keeps typecheck + tests green at its commit.
