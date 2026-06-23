# Route stock quotes by market — Tencent for US/HK/CN, Yahoo for JP

Date: 2026-06-23
Branch: `feature/tencent-stock-source`

## Motivation

Stock quotes currently come from Yahoo Finance via an unofficial cookie/crumb
auth flow (`_shared/stocks/yahoo.ts` + a `yahoo_auth` crumb cache). That auth
hack is the most fragile part of the stock pipeline.

The trigger was a request to integrate
[`a-stock-data`](https://github.com/simonlin1212/a-stock-data). That project is
a Python toolkit / Claude skill (mootdx TCP + Eastmoney/Sina/Tencent HTTP),
covering **China A-shares only** — it cannot run inside our Deno/TypeScript
Supabase Edge Functions. What *is* reusable is its recommended free quote
source: **Tencent `qt.gtimg.cn`** — no auth, no API key, no IP-block, batched
GET. HyChat already calls this endpoint (today only to read Chinese display
names in `_shared/stocks/tencent.ts`); the same response already carries the
full quote.

Verified live coverage of `qt.gtimg.cn`:

| Market | Supported | Symbol form |
| --- | --- | --- |
| CN (SH/SZ) | yes | `sh600519`, `sz000001` |
| HK | yes | `hk00700` (5-digit zero-pad) |
| US (stocks/ADR/ETF) | yes | `usAAPL`, `usTM`, `usSPY` |
| JP (Tokyo-listed) | **no** | `jp7203` → `v_pv_none_match` |

## Decisions

- **Tencent serves US + HK + CN. Yahoo is kept only for JP.** (Beijing-exchange
  `bj…` codes stay unsupported, exactly as today — out of scope.)
- **US display names stay English.** Tencent's US response carries the English
  name at a stable field index (46, verified across AAPL/MSFT/TM/SPY/BRK.A — all
  71 fields). So US names come from Tencent too; **no Yahoo dependency for US.**
- The separate Tencent *name-resolver* step is **removed** — every provider now
  returns its own display name, so `resolveStockQuotes` no longer needs a
  second name lookup.
- **No DB migration.** `stock_quotes.provider` is `text not null` with no CHECK
  constraint; storing `provider = 'tencent'` is fine. No new market, so the
  existing `stock_quotes_market_check` is untouched.

## Architecture

`resolveStockQuotes` (`_shared/stocks/cache.ts`) is the orchestrator. It already
takes **one** `EdgeStockProvider` and calls `getQuotes(symbols)` once for all
markets — it is provider-agnostic. We change only what gets passed in.

```
get-stock-quotes / refresh-active-quotes (wiring)
        │  provider: createRoutingProvider(tencent, yahoo)
        ▼
resolveStockQuotes  (cache.ts — unchanged contract; name-resolver removed)
        │  getQuotes(allSymbols)
        ▼
createRoutingProvider           split by market, run legs in parallel, merge
   ├── US/HK/CN ─► createTencentProvider   (new)  → qt.gtimg.cn batched GET
   └── JP       ─► createYahooProvider     (existing, unchanged)
```

## Components

### 1. `createTencentProvider` (new — `_shared/stocks/tencent-provider.ts`)

An `EdgeStockProvider` (`id: 'tencent'`) for US/HK/CN.

- Map each `EdgeNormalizedSymbol` to a Tencent ticker: US → `us<CODE>`,
  HK → `hk<code.padStart(5,'0')>`, CN → `sh`/`sz` by `providerExchange`. Reuse
  the existing `toTencentSymbol` shape; extend it to cover US.
- One batched `GET https://qt.gtimg.cn/q=<joined>` with a browser `User-Agent`.
  Decode **GBK** (`new TextDecoder('gbk')`), as the current code already does.
- **Parsing** is a pure function `parseTencentQuotes(text, tencentToSymbol)`
  (Layer 1). Each line is `v_<ticker>="<f0>~<f1>~…";`. Robust field reads:
  - `name`: US → `field[46]` (English; guard: must contain a latin letter,
    else fall back to ticker); HK/CN → `field[1]` (Chinese).
  - `price = field[3]`, `prevClose = field[4]`.
  - `change = price − prevClose`, `changePercent = change / prevClose * 100`
    (computed — avoids the per-market drift in Tencent's own change fields).
  - `currency` inferred from market: US→USD, HK→HKD, CN→CNY.
  - `marketTime`: best-effort parse of the per-market datetime field; undefined
    if unparseable (display does not depend on it).
  - Unknown symbols (`v_pv_none_match`, or price field empty/`0` with no data)
    are **omitted** → resolver treats them as not-found and serves stale.
- The fetch shell is thin (Layer 3): GET + decode + call the pure parser.

### 2. `createRoutingProvider` (new — `_shared/stocks/routing-provider.ts`)

An `EdgeStockProvider` (`id: 'tencent+yahoo'`) composing the two.

- Pure helper `splitByMarket(symbols)` → `{ tencent: [...US/HK/CN], yahoo: [...JP] }`
  (Layer 1, TDD).
- `getQuotes`: run each non-empty leg via `Promise.allSettled`, concat the
  fulfilled results. **Throw only if every leg that had symbols rejected**
  (preserves the existing whole-batch-failure semantics without one market's
  outage blaming another). Partial success returns what it has; missing symbols
  fall through the resolver's existing not-found → stale path.

### 3. `cache.ts` simplification (`_shared/stocks/cache.ts`)

- Remove the `nameResolver` param, the `ChineseNameResolver` type, the
  `needNames` Tencent lookup block, and the `resolveDisplayName` /
  `hasChineseName` helpers.
- Display name collapses to **the provider's `fresh.name`** (Tencent already
  returns English for US, Chinese for HK/CN; Yahoo returns English for JP).

### 4. Wiring — both Edge Functions

`get-stock-quotes/index.ts` and `refresh-active-quotes/index.ts` currently build
`provider: createYahooProvider({ store: createYahooAuthStore(supabase) })` and
pass `nameResolver: fetchChineseNames`. Change both to:

```ts
provider: createRoutingProvider(
  createTencentProvider(),
  createYahooProvider({ store: createYahooAuthStore(supabase) })
)
```

and drop the `nameResolver` line. Yahoo auth store stays (JP still needs it).

### 5. Removals

- `_shared/stocks/tencent.ts` (name-only resolver) is deleted; its parsing idea
  moves into the new provider parser.
- `tests/edge/tencent.test.ts` is rewritten to cover `parseTencentQuotes`.

## Testing strategy (per CLAUDE.md layers)

- **Layer 1 (strict TDD, write tests first):**
  - `parseTencentQuotes` — fixtures captured from live `qt.gtimg.cn`:
    `sh600519` (贵州茅台), `hk00700` (腾讯控股), `usAAPL`/`usMSFT`/`usTM`/`usSPY`/`usBRK.A`
    (English name at field 46), and a `v_pv_none_match` miss. Assert
    name/price/change%/currency per market and that misses are dropped.
  - `splitByMarket` — US/HK/CN → tencent leg, JP → yahoo leg.
  - Updated `cache.ts` resolver tests in `tests/edge/get-stock-quotes.test.ts`
    (name now comes straight from the provider; no resolver).
- **Layer 3 (no mock TDD — real verification):** the Tencent/routing fetch
  shells and both Edge Functions. Deploy and smoke-run.

## Verification plan

1. `pnpm typecheck` and `pnpm test` (vitest) — both pass.
2. `supabase functions deploy get-stock-quotes refresh-active-quotes` (they
   share `_shared/stocks`).
3. Real `/stock` smoke run in `pnpm dev` across all four markets:
   - `AAPL.US` → English name + price, `0700.HK` / `600519.CN` → Chinese name +
     price, `7203.JP` → still works via Yahoo.
   - A `/watch` + cron `refresh-active-quotes` cycle still broadcasts quotes.
   - Note: free US quotes may lag ~15 min intraday (same as the old Yahoo feed).
4. Report honestly what was test-verified vs smoke-verified.

## Out of scope

- Beijing exchange (`bj…`) symbols (unsupported today; no regression).
- Making the provider runtime-configurable / pluggable via env.
- Eastmoney or Sina as additional sources.
- Importing or running any `a-stock-data` Python code.

## Docs to update in the same change

- `CHANGELOG.md` (Unreleased → Changed): US/HK/CN quotes now sourced from
  Tencent; Yahoo retained only for JP. (US English names preserved.)
- `docs/CODE_MAP.md`: add `tencent-provider.ts` and `routing-provider.ts`,
  update the `yahoo.ts` note to "JP only", drop the old `tencent.ts` name-only
  entry, and update the `cache.ts` note (name-resolver removed).
