# Stock display core fixes

## Problem

The stock query/display feature under-delivers on its core promise:

1. **`/stock <symbol>` produces no visible result.** The handler fetches the
   quote into `quotesBySymbol` and sets status `"Stock loaded: AAPL.US."`
   (`chat-session.ts`), but both render surfaces (`TopInfoPanel`, `StatusBar`)
   only iterate the *watchlist*. A one-off lookup on an unwatched symbol — or
   any lookup outside a room — shows the word "loaded" and no price.
2. **No red/green coloring.** `formatQuoteChange` returns a plain string that is
   concatenated into the `Stocks:` line, so it cannot be wrapped in a colored
   `<Text>`. Everything renders monochrome.
3. **Raw number formatting.** `price` is rendered as the raw value and percent
   as `${changePercent}%` — no fixed decimals, so `150` sits next to `150.2`
   and a float can print as `1.23456%`.

Out of scope for this pass (deferred): surfacing market time / staleness,
currency, company name, absolute change, and capping the stocks line width.

## Approach

Keep the Ink components thin; put formatting in a pure L1 module so it is
TDD-tested.

### 1. New pure module `src/stocks/format.ts` (L1, strict TDD)

- `formatQuotePrice(price: number | undefined): string` — `'-'` when undefined,
  otherwise `toFixed(2)`.
- `formatQuoteChangePercent(changePercent: number | undefined): string` —
  `'-'` when undefined, signed, `toFixed(2)`, `%` suffix.
- `quoteChangeColor(changePercent): 'green' | 'red' | undefined` — undefined for
  missing or flat (0).
- `formatQuoteStatusLine(symbol, price, changePercent): string` — the line
  echoed into the status area by `/stock`; `"<symbol>: no quote available."`
  when price is undefined.

Module takes primitives only (no import from `ui/state`), so the dependency
direction stays `ui -> stocks`.

### 2. `chat-session.ts`

- `refreshQuotes` returns its `QuoteApiResult` so callers can branch.
- `/stock` handler: after refresh, if the symbol is in `result.failed` show
  `"<symbol>: <reason>"`; otherwise echo `formatQuoteStatusLine(...)` from the
  freshly-stored quote. Remove the old `"Stock loaded: …"` string.

### 3. `App.tsx`

- `TopInfoPanel` stocks line: replace the joined string with mapped fragments
  so each symbol's percent renders in a colored `<Text>` via `quoteChangeColor`,
  using `formatQuotePrice` / `formatQuoteChangePercent`.
- `StatusBar` (single dim string, no per-segment color): swap the local
  `formatQuoteChange` for `formatQuoteChangePercent` for consistent formatting.
- Delete the now-unused local `formatQuoteChange`.

## Verification

- `pnpm typecheck` + `pnpm test` (new format tests + existing suites).
- Smoke run: `/stock AAPL.US` shows a formatted price line; a watched symbol's
  change renders green/red in the top panel.
