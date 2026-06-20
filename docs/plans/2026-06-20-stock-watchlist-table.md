# Stock watchlist header redesign — vertical aligned table

## Problem

The header `Stocks:` line (`src/ui/App.tsx` `TopInfoPanel`) renders all symbols
on a single inline `<Text>` joined by ` | `. With more than ~2 symbols it is
wider than the panel, so Ink wraps it — and wraps mid-token (a `+4.62%` gets
orphaned onto its own line). The header box is a fixed `topHeight = 5`, so the
wrapped lines overflow the border and collide with the chat below.

Also: symbols are shown as raw codes (`7709.HK`). We want the human shortname
(`腾讯控股`, `Apple Inc.`) instead.

## Decision

Lay the watchlist out as a **vertical aligned table**, one stock per row, with
aligned columns. Chosen by the user over a compact one-line ticker and a
two-column grid.

```
Stocks
  腾讯控股      161.00  ▲ 11.19%
  Apple Inc.   298.01  ▲  0.70%
  ...
```

- green `▲` / red `▼`, flat = no arrow; price dim; label = shortname, falling
  back to the symbol code when no name is known yet.
- Columns never wrap (each cell is a fixed-width Ink `Box`; Ink measures CJK
  display width). The header height grows with content instead of overflowing.
- Watchlist cap is 50, so visible rows are capped (8) with a `+N more` line to
  protect the layout.

## Changes

### Plumb shortname through (no schema change — `name` already in `stock_quotes`)

The name is fetched by Yahoo and stored in the cache, but `ResolvedQuote` drops
it. Re-include it end to end:

1. `supabase/functions/_shared/stocks/cache.ts` — add `name?` to
   `ResolvedQuote`, set it in `toResolvedQuote`.
2. `src/supabase/realtime.ts` — add `name?` to `BroadcastQuote`.
3. `src/app/chat-session.ts` — add `name?` to `QuoteApiResult.quotes`, carry it
   in `onQuotesUpdate` mapping and `toQuoteSummary`.
4. `src/ui/state.ts` — add `name?` to `QuoteSummary`.

Both Edge Functions (`get-stock-quotes`, `refresh-active-quotes`) must be
redeployed so their output carries `name`.

### Display (Layer 1 pure + thin Ink render)

5. `src/stocks/format.ts` — `buildWatchlistTable(quotes, opts)` returns per-row
   cells (`label`, `price`, `percent`, `direction`) plus capped column widths
   and `hiddenCount`. CJK-aware widths via `string-width` (add as direct dep).
   Strict TDD in `format.test.ts`.
6. `src/ui/App.tsx` — render rows as aligned `Box` columns; compute `topHeight`
   dynamically from the row count.

## Verification

- `pnpm typecheck` + `pnpm test` (format builder is the spec).
- Deploy both edge functions; smoke run `pnpm dev:tmux` to confirm shortnames
  render, columns align (incl. CJK), and the header grows without overflow.
- Update `docs/CODE_MAP.md` (format.ts now owns the table builder) and
  `CHANGELOG.md`.
