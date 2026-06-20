# Swap stock provider to Yahoo Finance + add Japan market

## Why

Twelve Data's free tier is US-weighted: the code parses `.HK`/`.CN` symbols but
the free key does not reliably return HK / A-share / Japan quotes. We want all
four markets (US, HK, China A-share, Japan) at zero recurring cost.

Live probes (2026-06-17) confirm Yahoo's keyless `v8/finance/chart` endpoint
returns price + currency + exchange + name for one source across all four
markets:

| symbol | price | currency | exchange |
| --- | --- | --- | --- |
| `AAPL` | 299.24 | USD | NMS |
| `0700.HK` | 445.4 | HKD | HKG |
| `600519.SS` | 1240 | CNY | SHH |
| `000001.SZ` | 10.78 | CNY | SHZ |
| `7203.T` | 2810 | JPY | JPX |

There is no official Yahoo API doc; the de-facto reference is the `yfinance`
library, which uses the same `v8/finance/chart` endpoint with a browser
`User-Agent`. The per-symbol chart endpoint needs **no crumb/cookie** (verified),
so it maps directly onto our existing `EdgeStockProvider.getQuote(symbol)` shape.

## Endpoint contract (verified, not from docs)

`GET https://query1.finance.yahoo.com/v8/finance/chart/<YahooSymbol>?interval=1d&range=1d`
with header `User-Agent: Mozilla/5.0`.

- Success: `chart.result[0].meta` has `regularMarketPrice`, `chartPreviousClose`,
  `regularMarketTime` (unix seconds), `currency`, `exchangeName`,
  `longName`/`shortName`.
- `change = price - chartPreviousClose`, `changePercent = change / chartPreviousClose * 100`.
- Error: `chart.result === null` and `chart.error = { code, description }`.

## Yahoo symbol mapping (canonical -> Yahoo)

- US `AAPL.US` -> `AAPL`
- HK `0700.HK` -> `0700.HK`
- CN SSE `600519.CN` -> `600519.SS`
- CN SZSE `000001.CN` -> `000001.SZ`
- JP `7203.JP` -> `7203.T`

## Changes

1. **Migration** (`stock_quotes.market` CHECK extended to include `JP`).
   `room_watchlist.canonical_symbol` is free text — no change.
2. **Edge `_shared/stocks/provider.ts`**: `EdgeMarket` + parse gains `JP`
   (providerExchange `TSE`, micCode `XTKS`).
3. **Edge `_shared/stocks/yahoo.ts`** (new): `createYahooProvider()` — keyless,
   maps symbol, parses `v8/chart`, computes change%. Replaces `twelve-data.ts`
   (deleted).
4. **Edge `get-stock-quotes/index.ts`**: use `createYahooProvider()`; drop the
   `TWELVE_DATA_API_KEY` requirement.
5. **Client `src/stocks/{provider,symbols}.ts`**: `Market` + parse gains `JP`
   (4-digit numeric code; alphanumeric TSE codes not supported yet — acceptable
   friction). Numeric-suffix error message mentions `.JP`.
6. **Client config**: `STOCK_PROVIDER` literal `twelve_data` -> `yahoo_finance`
   (cosmetic doctor line only). Update `.env.example`, README, USER_SETUP,
   TECHNICAL_DESIGN.

## Tests / verification

- L1 unit: `symbols.test.ts` gains JP cases; new `tests/edge/yahoo.test.ts`
  feeds canned success + error payloads through an injected `fetchImpl` and
  asserts price/change%/symbol-mapping and the thrown error on `chart.error`.
- `pnpm typecheck` + `pnpm test`.
- `supabase db push` for the migration.
- Smoke: `/watch add 7203.JP`, `/stock 600519.CN`, `/stock 0700.HK` against the
  remote DB once the function + migration are deployed.

## Known limitations (deferred)

- Yahoo is unofficial: can rate-limit/change/block. Sina/Tencent fallback is a
  later option only if Yahoo misbehaves (avoids extra moving parts now).
- Japan alphanumeric ticker codes (post-2024 TSE) not parsed yet.
