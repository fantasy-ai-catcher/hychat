# Manual watchlist reordering (interactive mode)

Date: 2026-06-25
Branch: `feature/stock-reorder` (off `feature/color-picker`)

## Motivation

The header watchlist order is fixed (insertion order). Friends want to arrange
it. Mouse drag is impractical in a terminal (fights text selection, needs full
SGR press/motion/release parsing); the robust TUI approach is keyboard.

## Decisions (from brainstorming)

- **Manual custom order**, not auto-sort-by-column.
- **Shared per room** — whoever reorders, everyone in the room sees it.
- **Interactive "grab" mode** (like the color picker): `/watch reorder` opens a
  panel above the input box. `↑↓` move the selection; `Space` grabs/drops the
  highlighted stock; while grabbed, `↑↓` move that stock; `Enter` saves, `Esc`
  cancels, `Ctrl+C` exits.

## Data / persistence (Supabase migration)

`room_watchlist` (PK `room_id, canonical_symbol`) currently has no order column;
`listWatchlist` orders by `created_at`.

- Add `sort_order int not null default 0` to `room_watchlist`.
- Backfill existing rows: per room, `sort_order = row_number()` over `created_at`.
- `BEFORE INSERT` trigger sets `sort_order = coalesce(max(sort_order)+1, 0)` for
  the room when the inserted value is 0/default, so `/watch add` appends.
- RPC `reorder_watchlist(target_room_id uuid, ordered_symbols text[])`:
  security definer; verifies `auth.uid()` is a member of the room; sets each
  listed symbol's `sort_order` to its array index. Tolerant — symbols not in the
  array or no longer present are left/ignored (concurrent add/remove safe).
- `listWatchlist` orders by `sort_order` (then `created_at` as a stable tiebreak).

Realtime: `room_watchlist` postgres_changes already triggers `onWatchlistChange`
on every client → they reload and see the new order. No extra broadcast.

## Code structure

- **Layer 1 (strict TDD)** `src/ui/reorder.ts`: `moveItem<T>(list, index, dir)`
  returns a new array with the item at `index` moved one step `'up'`/`'down'`
  (clamped: up at 0 / down at end = unchanged).
- **service** `src/app/hychat-service.ts`: `listWatchlist` orders by `sort_order`;
  add `reorderWatchlist(roomId, orderedSymbols)` calling the RPC.
- **session** `src/app/chat-session.ts`: `ChatServiceLike.reorderWatchlist?`;
  snapshot `watchReorderOpen: boolean`; `/watch reorder` opens it (only with a
  room + ≥1 watched symbol, else a status hint); methods `reorderWatchlist(symbols)`
  (persist via service, reload, close) and `closeWatchReorder()`.
- **commands** `src/chat/commands.ts`: parse `/watch reorder` → `watch-reorder`.
- **App** `src/ui/App.tsx`: `WatchReorder` panel (vertical list: name + symbol,
  `▸` selection, `»` when grabbed) rendered above the input box (reuse the color
  picker's layout/height/routing pattern); local state `{ order, index, grabbed }`
  initialized from `watchlistByRoom` + `quotesBySymbol` when it opens; `useInput`
  routes ↑↓/Space/Enter/Esc and swallows the rest; Ctrl+C still exits. New pure
  `watchReorderHeight(rowCount)` for the layout math.

## Testing

- L1 strict TDD: `moveItem` (up at top no-op, down at bottom no-op, normal swaps,
  index follows the moved item).
- L2 minimal: `WatchReorder` open lists every watched symbol (content only).
- session tests: `/watch reorder` opens; `reorderWatchlist` persists + closes;
  `closeWatchReorder` closes without persisting; `/watch reorder` with no room or
  empty watchlist shows a hint and does not open.
- Smoke (`pnpm dev`): `/watch reorder` → grab + move + Enter → order persists and
  another client sees it via realtime; `/watch add` appends to the end.
- ⚠️ Supabase migration must be applied to the DB (SQL editor / `db push`) first.

## Out of scope

- Auto sort-by-column; per-user (non-shared) ordering; mouse drag.

## Docs to update

- `CHANGELOG.md` (Added): `/watch reorder` interactive reordering.
- `docs/CODE_MAP.md`: `reorder.ts`; App `WatchReorder`; `chat-session` reorder
  state/methods; `commands` `/watch reorder`; migration note (sort_order + RPC).
