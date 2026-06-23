# Tencent Stock Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source US/HK/CN stock quotes from Tencent `qt.gtimg.cn` (keyless, no IP-block, English US names included) while keeping Yahoo only for JP.

**Architecture:** A new `createTencentProvider` (US/HK/CN) and the existing `createYahooProvider` (JP) are combined by a `createRoutingProvider` that splits symbols by market and merges results. The well-tested `resolveStockQuotes` orchestrator stays provider-agnostic; the now-redundant separate Chinese-name resolver is deleted because every provider returns its own display name.

**Tech Stack:** TypeScript, Deno (Supabase Edge Functions), vitest. Design spec: `docs/plans/2026-06-23-tencent-stock-source.md`.

---

## Prerequisite

`pnpm typecheck` / `pnpm test` / `pnpm dev` / `supabase` require a working Node + Supabase CLI. The machine's `node@24` is currently broken (missing `libsimdjson.31.dylib`); fix it first (e.g. `brew reinstall node@24`) or the verification commands below cannot run.

## File Structure

**Create:**
- `supabase/functions/_shared/stocks/tencent-provider.ts` — Tencent `EdgeStockProvider` for US/HK/CN: `toTencentSymbol`, pure `parseTencentQuotes`, `createTencentProvider` fetch shell.
- `supabase/functions/_shared/stocks/routing-provider.ts` — `splitByMarket` (pure) + `createRoutingProvider` (merges Tencent + Yahoo legs).
- `tests/edge/tencent-provider.test.ts` — unit tests for the symbol map + parser.
- `tests/edge/routing-provider.test.ts` — unit tests for the splitter + router.

**Modify:**
- `supabase/functions/get-stock-quotes/index.ts` — wire the routing provider; drop the name resolver.
- `supabase/functions/refresh-active-quotes/index.ts` — same.
- `supabase/functions/_shared/stocks/cache.ts` — remove `nameResolver` / `ChineseNameResolver` / `resolveDisplayName` / `hasChineseName`; name comes straight from the provider quote.
- `tests/edge/get-stock-quotes.test.ts` — remove the name-resolver test; add a provider-name test.
- `CHANGELOG.md`, `docs/CODE_MAP.md`.

**Delete:**
- `supabase/functions/_shared/stocks/tencent.ts` (name-only resolver).
- `tests/edge/tencent.test.ts` (old name-resolver tests).

**Conventions (verified in this repo):** edge source files import siblings with the `.ts` extension (matches `index.ts`/`store.ts`); test files import edge modules with the `.js` extension (vitest/tsc resolve `.js`→`.ts`). No DB migration — `stock_quotes.provider` is unconstrained `text`.

---

## Task 1: Tencent symbol mapping (`toTencentSymbol`)

**Files:**
- Create: `supabase/functions/_shared/stocks/tencent-provider.ts`
- Test: `tests/edge/tencent-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/edge/tencent-provider.test.ts
import { describe, expect, it } from 'vitest';

import { toTencentSymbol } from '../../supabase/functions/_shared/stocks/tencent-provider.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

describe('toTencentSymbol', () => {
  it('prefixes US tickers with us', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('AAPL.US'))).toBe('usAAPL');
  });

  it('zero-pads HK codes to five digits', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('0700.HK'))).toBe('hk00700');
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('7709.HK'))).toBe('hk07709');
  });

  it('prefixes A-shares by exchange', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('600519.CN'))).toBe('sh600519');
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('000001.CN'))).toBe('sz000001');
  });

  it('returns null for JP (handled by Yahoo)', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('7203.JP'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/edge/tencent-provider.test.ts`
Expected: FAIL — cannot resolve `tencent-provider` / `toTencentSymbol` is not a function.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/stocks/tencent-provider.ts
import type { EdgeNormalizedSymbol } from './provider.ts';

// Map a normalized symbol to Tencent's market-prefixed ticker.
// US -> usAAPL, HK -> hk00700 (5-digit), CN -> sh/sz<code>, JP -> null.
export function toTencentSymbol(symbol: EdgeNormalizedSymbol): string | null {
  switch (symbol.market) {
    case 'US':
      return `us${symbol.code.toUpperCase()}`;
    case 'HK':
      return `hk${symbol.code.padStart(5, '0')}`;
    case 'CN':
      return `${symbol.providerExchange === 'SSE' ? 'sh' : 'sz'}${symbol.code}`;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/edge/tencent-provider.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stocks/tencent-provider.ts tests/edge/tencent-provider.test.ts
git commit -m "feat: add Tencent symbol mapping (US/HK/CN)"
```

---

## Task 2: Tencent response parser (`parseTencentQuotes`)

**Files:**
- Modify: `supabase/functions/_shared/stocks/tencent-provider.ts`
- Test: `tests/edge/tencent-provider.test.ts`

Field layout (verified live against `qt.gtimg.cn`): `[1]` Chinese name, `[2]` echoed symbol, `[3]` current price, `[4]` previous close; US rows also carry the English name at `[46]`. Change/percent sit at market-specific offsets, so we compute them from `price - prevClose` (identical to Tencent's own values: AAPL −0.34%, 700 −4.20%, 600519 −1.53%).

- [ ] **Step 1: Write the failing test** (append to `tests/edge/tencent-provider.test.ts`)

```ts
import { parseTencentQuotes } from '../../supabase/functions/_shared/stocks/tencent-provider.js';
import type { EdgeNormalizedSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

function mapping(...pairs: Array<[string, string]>) {
  const m = new Map<string, EdgeNormalizedSymbol>();
  for (const [ticker, canonical] of pairs) {
    m.set(ticker, parseEdgeCanonicalSymbol(canonical));
  }
  return m;
}

describe('parseTencentQuotes', () => {
  // Real field shapes captured from qt.gtimg.cn (trimmed to the fields we read;
  // index 46 is the English name for US rows).
  const usLine =
    'v_usAAPL="200~苹果~AAPL.OQ~297.01~298.01~297.31~' +
    Array(40).fill('0').join('~') + '~Apple Inc.~tail";';
  const hkLine = 'v_hk00700="100~腾讯控股~00700~414.800~433.000~430.000~rest";';
  const cnLine = 'v_sh600519="1~贵州茅台~600519~1222.45~1241.41~1239.00~rest";';

  it('parses a US quote with the English name (field 46) and computed change%', () => {
    const quotes = parseTencentQuotes(usLine, mapping(['usaapl', 'AAPL.US']));
    expect(quotes).toHaveLength(1);
    const q = quotes[0];
    expect(q.canonicalSymbol).toBe('AAPL.US');
    expect(q.name).toBe('Apple Inc.');
    expect(q.currency).toBe('USD');
    expect(q.price).toBe(297.01);
    expect(q.change).toBeCloseTo(-1.0, 2);
    expect(q.changePercent).toBeCloseTo(-0.3355, 3);
    expect(q.provider).toBe('tencent');
    expect(q.status).toBe('ok');
  });

  it('parses HK/CN quotes with the Chinese name (field 1) and market currency', () => {
    const hk = parseTencentQuotes(hkLine, mapping(['hk00700', '0700.HK']))[0];
    expect(hk.name).toBe('腾讯控股');
    expect(hk.currency).toBe('HKD');
    expect(hk.price).toBe(414.8);
    expect(hk.changePercent).toBeCloseTo(-4.203, 2);

    const cn = parseTencentQuotes(cnLine, mapping(['sh600519', '600519.CN']))[0];
    expect(cn.name).toBe('贵州茅台');
    expect(cn.currency).toBe('CNY');
    expect(cn.changePercent).toBeCloseTo(-1.527, 2);
  });

  it('drops misses (v_pv_none_match) and tickers not in the mapping', () => {
    const text = 'v_pv_none_match="1";\n' + hkLine;
    const quotes = parseTencentQuotes(text, mapping(['hk00700', '0700.HK']));
    expect(quotes.map((q) => q.canonicalSymbol)).toEqual(['0700.HK']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/edge/tencent-provider.test.ts`
Expected: FAIL — `parseTencentQuotes` is not a function.

- [ ] **Step 3: Write minimal implementation** (add to `tencent-provider.ts`)

```ts
import type {
  CachedStockQuote,
  EdgeMarket,
  EdgeNormalizedSymbol
} from './provider.ts';

function currencyFor(market: EdgeMarket): string {
  return market === 'US' ? 'USD' : market === 'HK' ? 'HKD' : 'CNY';
}

const hasLatinLetter = (value: string | undefined): boolean => /[A-Za-z]/.test(value ?? '');

// One quote line: v_<ticker>="<f0>~<f1>~...";  Unknown tickers and the
// v_pv_none_match miss line are skipped by the mapping lookup.
export function parseTencentQuotes(
  text: string,
  tickerToSymbol: Map<string, EdgeNormalizedSymbol>
): CachedStockQuote[] {
  const quotes: CachedStockQuote[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^v_([a-z0-9._]+)="([^"]*)"/i);
    if (!match) {
      continue;
    }
    const symbol = tickerToSymbol.get(match[1].toLowerCase());
    if (!symbol) {
      continue;
    }
    const fields = match[2].split('~');
    const price = Number(fields[3]);
    if (!Number.isFinite(price) || price === 0) {
      continue; // no usable price -> treat as not found, resolver serves stale
    }
    const prevClose = Number(fields[4]);
    const hasPrev = Number.isFinite(prevClose) && prevClose !== 0;
    const change = hasPrev ? price - prevClose : undefined;
    const changePercent = hasPrev ? ((price - prevClose) / prevClose) * 100 : undefined;
    const rawName =
      symbol.market === 'US'
        ? hasLatinLetter(fields[46])
          ? fields[46]
          : fields[2] || fields[1]
        : fields[1];

    quotes.push({
      canonicalSymbol: symbol.canonicalSymbol,
      market: symbol.market,
      providerSymbol: match[1],
      providerExchange: symbol.providerExchange,
      micCode: symbol.micCode,
      name: rawName?.trim() || undefined,
      currency: currencyFor(symbol.market),
      price,
      change,
      changePercent,
      provider: 'tencent',
      providerPayload: { marketCode: fields[0] },
      status: 'ok',
      // Overwritten by the cache resolver with the real TTL / timestamps.
      cacheExpiresAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    });
  }
  return quotes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/edge/tencent-provider.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stocks/tencent-provider.ts tests/edge/tencent-provider.test.ts
git commit -m "feat: parse Tencent quote responses (price/change/name per market)"
```

---

## Task 3: Tencent provider fetch shell (`createTencentProvider`)

**Files:**
- Modify: `supabase/functions/_shared/stocks/tencent-provider.ts`
- Test: `tests/edge/tencent-provider.test.ts`

This is the Layer-3 boundary (network + GBK decode). The test injects `fetchImpl` and uses a US-only ASCII fixture (ASCII is byte-identical under GBK decode) to verify URL construction and delegation; CJK parsing is already covered by Task 2. Real CN/HK decoding is verified in the smoke run.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { createTencentProvider } from '../../supabase/functions/_shared/stocks/tencent-provider.js';

describe('createTencentProvider', () => {
  it('batches US/HK/CN into one GET and skips JP, returning parsed quotes', async () => {
    const calls: string[] = [];
    const body =
      'v_usAAPL="200~Apple~AAPL.OQ~297.01~298.01~x~' +
      Array(40).fill('0').join('~') + '~Apple Inc.~t";';
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createTencentProvider({ fetchImpl });
    const quotes = await provider.getQuotes([
      parseEdgeCanonicalSymbol('AAPL.US'),
      parseEdgeCanonicalSymbol('7203.JP') // JP -> not sent to Tencent
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('qt.gtimg.cn/q=usAAPL');
    expect(calls[0]).not.toContain('7203');
    expect(quotes.map((q) => q.canonicalSymbol)).toEqual(['AAPL.US']);
    expect(quotes[0].name).toBe('Apple Inc.');
  });

  it('returns [] without fetching when no symbol maps to Tencent', async () => {
    const fetchImpl = (async () => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;
    const provider = createTencentProvider({ fetchImpl });
    expect(await provider.getQuotes([parseEdgeCanonicalSymbol('7203.JP')])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/edge/tencent-provider.test.ts`
Expected: FAIL — `createTencentProvider` is not a function.

- [ ] **Step 3: Write minimal implementation** (add to `tencent-provider.ts`)

```ts
import type { EdgeStockProvider } from './provider.ts';

const USER_AGENT = 'Mozilla/5.0';
const QUOTE_BASE = 'https://qt.gtimg.cn/q=';

// qt.gtimg.cn prices US/HK/CN in one keyless GET and returns a GBK-encoded body.
// JP is not covered here (the router sends JP to Yahoo).
export function createTencentProvider(opts: { fetchImpl?: typeof fetch } = {}): EdgeStockProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: 'tencent',
    async getQuotes(symbols: EdgeNormalizedSymbol[]): Promise<CachedStockQuote[]> {
      const tickerToSymbol = new Map<string, EdgeNormalizedSymbol>();
      const tickers: string[] = [];
      for (const symbol of symbols) {
        const ticker = toTencentSymbol(symbol);
        if (ticker) {
          tickerToSymbol.set(ticker.toLowerCase(), symbol);
          tickers.push(ticker);
        }
      }
      if (tickers.length === 0) {
        return [];
      }

      const response = await fetchImpl(`${QUOTE_BASE}${tickers.join(',')}`, {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }
      const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
      return parseTencentQuotes(text, tickerToSymbol);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/edge/tencent-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stocks/tencent-provider.ts tests/edge/tencent-provider.test.ts
git commit -m "feat: add Tencent provider fetch+decode shell"
```

---

## Task 4: Market splitter (`splitByMarket`)

**Files:**
- Create: `supabase/functions/_shared/stocks/routing-provider.ts`
- Test: `tests/edge/routing-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/edge/routing-provider.test.ts
import { describe, expect, it } from 'vitest';

import { splitByMarket } from '../../supabase/functions/_shared/stocks/routing-provider.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

describe('splitByMarket', () => {
  it('routes US/HK/CN to Tencent and JP to Yahoo', () => {
    const split = splitByMarket(
      ['AAPL.US', '0700.HK', '600519.CN', '7203.JP'].map(parseEdgeCanonicalSymbol)
    );
    expect(split.tencent.map((s) => s.canonicalSymbol)).toEqual([
      'AAPL.US',
      '0700.HK',
      '600519.CN'
    ]);
    expect(split.yahoo.map((s) => s.canonicalSymbol)).toEqual(['7203.JP']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/edge/routing-provider.test.ts`
Expected: FAIL — cannot resolve `routing-provider`.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/stocks/routing-provider.ts
import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from './provider.ts';

export type SymbolSplit = {
  tencent: EdgeNormalizedSymbol[];
  yahoo: EdgeNormalizedSymbol[];
};

// US/HK/CN are priced by Tencent; JP (which Tencent does not cover) by Yahoo.
export function splitByMarket(symbols: EdgeNormalizedSymbol[]): SymbolSplit {
  const split: SymbolSplit = { tencent: [], yahoo: [] };
  for (const symbol of symbols) {
    if (symbol.market === 'JP') {
      split.yahoo.push(symbol);
    } else {
      split.tencent.push(symbol);
    }
  }
  return split;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/edge/routing-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stocks/routing-provider.ts tests/edge/routing-provider.test.ts
git commit -m "feat: add market splitter for stock provider routing"
```

---

## Task 5: Routing provider (`createRoutingProvider`)

**Files:**
- Modify: `supabase/functions/_shared/stocks/routing-provider.ts`
- Test: `tests/edge/routing-provider.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { createRoutingProvider } from '../../supabase/functions/_shared/stocks/routing-provider.js';
import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from '../../supabase/functions/_shared/stocks/provider.js';

function fakeProvider(
  id: string,
  impl: (symbols: EdgeNormalizedSymbol[]) => Promise<CachedStockQuote[]>
): EdgeStockProvider {
  return { id, getQuotes: impl };
}

function okQuote(symbol: EdgeNormalizedSymbol, provider: string): CachedStockQuote {
  return {
    canonicalSymbol: symbol.canonicalSymbol,
    market: symbol.market,
    providerSymbol: symbol.providerSymbol,
    provider,
    status: 'ok',
    price: 1,
    cacheExpiresAt: 'ignored',
    updatedAt: 'ignored'
  };
}

describe('createRoutingProvider', () => {
  it('sends each market to its provider and merges the results', async () => {
    const seen: Record<string, string[]> = { tencent: [], yahoo: [] };
    const tencent = fakeProvider('tencent', async (symbols) => {
      seen.tencent = symbols.map((s) => s.canonicalSymbol);
      return symbols.map((s) => okQuote(s, 'tencent'));
    });
    const yahoo = fakeProvider('yahoo_finance', async (symbols) => {
      seen.yahoo = symbols.map((s) => s.canonicalSymbol);
      return symbols.map((s) => okQuote(s, 'yahoo_finance'));
    });
    const provider = createRoutingProvider(tencent, yahoo);

    const quotes = await provider.getQuotes(
      ['AAPL.US', '7203.JP'].map(parseEdgeCanonicalSymbol)
    );

    expect(seen.tencent).toEqual(['AAPL.US']);
    expect(seen.yahoo).toEqual(['7203.JP']);
    expect(quotes.map((q) => `${q.canonicalSymbol}:${q.provider}`).sort()).toEqual([
      '7203.JP:yahoo_finance',
      'AAPL.US:tencent'
    ]);
  });

  it('returns the surviving leg when the other leg fails (no cross-blame)', async () => {
    const tencent = fakeProvider('tencent', async () => {
      throw new Error('tencent_down');
    });
    const yahoo = fakeProvider('yahoo_finance', async (symbols) =>
      symbols.map((s) => okQuote(s, 'yahoo_finance'))
    );
    const provider = createRoutingProvider(tencent, yahoo);

    const quotes = await provider.getQuotes(
      ['AAPL.US', '7203.JP'].map(parseEdgeCanonicalSymbol)
    );

    expect(quotes.map((q) => q.canonicalSymbol)).toEqual(['7203.JP']);
  });

  it('throws when every leg with symbols fails', async () => {
    const tencent = fakeProvider('tencent', async () => {
      throw new Error('tencent_down');
    });
    const yahoo = fakeProvider('yahoo_finance', async () => {
      throw new Error('yahoo_down');
    });
    const provider = createRoutingProvider(tencent, yahoo);

    await expect(
      provider.getQuotes(['AAPL.US', '7203.JP'].map(parseEdgeCanonicalSymbol))
    ).rejects.toThrow(/tencent_down|yahoo_down/);
  });

  it('throws when the only leg (Tencent) fails', async () => {
    const tencent = fakeProvider('tencent', async () => {
      throw new Error('tencent_down');
    });
    const yahoo = fakeProvider('yahoo_finance', async () => []);
    const provider = createRoutingProvider(tencent, yahoo);

    await expect(
      provider.getQuotes(['AAPL.US'].map(parseEdgeCanonicalSymbol))
    ).rejects.toThrow('tencent_down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/edge/routing-provider.test.ts`
Expected: FAIL — `createRoutingProvider` is not a function.

- [ ] **Step 3: Write minimal implementation** (add to `routing-provider.ts`)

```ts
// Routes each symbol to the provider that covers its market and merges results.
// Each leg runs independently so one market's outage never blames the other's
// symbols (missing symbols fall through to resolveStockQuotes' stale path).
// Throws only when every leg that had symbols failed, preserving the
// orchestrator's whole-batch-failure handling for a total outage.
export function createRoutingProvider(
  tencent: EdgeStockProvider,
  yahoo: EdgeStockProvider
): EdgeStockProvider {
  return {
    id: `${tencent.id}+${yahoo.id}`,
    async getQuotes(symbols: EdgeNormalizedSymbol[]): Promise<CachedStockQuote[]> {
      const split = splitByMarket(symbols);
      const legs: Array<EdgeNormalizedSymbol[]> = [];
      const providers: EdgeStockProvider[] = [];
      if (split.tencent.length > 0) {
        legs.push(split.tencent);
        providers.push(tencent);
      }
      if (split.yahoo.length > 0) {
        legs.push(split.yahoo);
        providers.push(yahoo);
      }

      const settled = await Promise.allSettled(
        legs.map((legSymbols, i) => providers[i].getQuotes(legSymbols))
      );

      const quotes: CachedStockQuote[] = [];
      const errors: string[] = [];
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          quotes.push(...result.value);
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : 'provider_error');
        }
      }

      if (legs.length > 0 && errors.length === legs.length) {
        throw new Error(errors.join(';'));
      }
      return quotes;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/edge/routing-provider.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stocks/routing-provider.ts tests/edge/routing-provider.test.ts
git commit -m "feat: route stock quotes to Tencent (US/HK/CN) and Yahoo (JP)"
```

---

## Task 6: Wire both Edge Functions to the routing provider

**Files:**
- Modify: `supabase/functions/get-stock-quotes/index.ts`
- Modify: `supabase/functions/refresh-active-quotes/index.ts`

No unit test (Layer 3 wiring; vitest does not import the function entry points). Verified by typecheck + deploy + smoke run later.

- [ ] **Step 1: Edit `get-stock-quotes/index.ts` imports**

Replace this line:

```ts
import { fetchChineseNames } from '../_shared/stocks/tencent.ts';
```

with:

```ts
import { createTencentProvider } from '../_shared/stocks/tencent-provider.ts';
import { createRoutingProvider } from '../_shared/stocks/routing-provider.ts';
```

(Keep the existing `createYahooProvider` and `createSupabaseQuoteCache, createYahooAuthStore` imports.)

- [ ] **Step 2: Edit the `resolveStockQuotes` call in `get-stock-quotes/index.ts`**

Replace these two lines:

```ts
      provider: createYahooProvider({ store: createYahooAuthStore(supabase) }),
      nameResolver: fetchChineseNames,
```

with:

```ts
      provider: createRoutingProvider(
        createTencentProvider(),
        createYahooProvider({ store: createYahooAuthStore(supabase) })
      ),
```

- [ ] **Step 3: Apply the identical edits to `refresh-active-quotes/index.ts`**

Replace this line:

```ts
import { fetchChineseNames } from '../_shared/stocks/tencent.ts';
```

with:

```ts
import { createTencentProvider } from '../_shared/stocks/tencent-provider.ts';
import { createRoutingProvider } from '../_shared/stocks/routing-provider.ts';
```

Then replace these two lines:

```ts
      provider: createYahooProvider({ store: createYahooAuthStore(supabase) }),
      nameResolver: fetchChineseNames,
```

with:

```ts
      provider: createRoutingProvider(
        createTencentProvider(),
        createYahooProvider({ store: createYahooAuthStore(supabase) })
      ),
```

- [ ] **Step 4: Verify the suite is still green**

Run: `pnpm exec vitest run`
Expected: PASS (the existing suite still passes; `nameResolver` is optional so removing it from the callers is valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/get-stock-quotes/index.ts supabase/functions/refresh-active-quotes/index.ts
git commit -m "feat: wire Edge Functions to the Tencent/Yahoo routing provider"
```

---

## Task 7: Delete the obsolete name-only resolver

**Files:**
- Delete: `supabase/functions/_shared/stocks/tencent.ts`
- Delete: `tests/edge/tencent.test.ts`

Both index.ts callers stopped importing `fetchChineseNames` in Task 6, so nothing imports `tencent.ts` anymore except its own test.

- [ ] **Step 1: Delete the files**

```bash
git rm supabase/functions/_shared/stocks/tencent.ts tests/edge/tencent.test.ts
```

- [ ] **Step 2: Verify typecheck + tests are green**

Run: `pnpm typecheck && pnpm exec vitest run`
Expected: PASS — no remaining references to the deleted module.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove obsolete Tencent name-only resolver"
```

---

## Task 8: Simplify the resolver (name comes from the provider)

**Files:**
- Modify: `supabase/functions/_shared/stocks/cache.ts`
- Modify: `tests/edge/get-stock-quotes.test.ts`

- [ ] **Step 1: Update the resolver tests first**

In `tests/edge/get-stock-quotes.test.ts`, **delete** the whole test
`it('overrides HK/CN names with the resolver and only asks for un-named symbols', ...)`
(the last test in the file, which passes a `nameResolver`), and add this test in its place:

```ts
  it('uses each provider quote name directly (no separate name resolver)', async () => {
    const cache = createCache();
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuotes(symbols) {
        return symbols.map((symbol) => ({
          canonicalSymbol: symbol.canonicalSymbol,
          market: symbol.market,
          providerSymbol: symbol.providerSymbol,
          provider: 'tencent',
          status: 'ok' as const,
          name: symbol.market === 'US' ? 'Apple Inc.' : '贵州茅台',
          price: 1,
          changePercent: 0,
          cacheExpiresAt: 'ignored',
          updatedAt: 'ignored'
        }));
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['AAPL.US', '600519.CN'],
      force: false,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60
    });

    const bySymbol = new Map(result.quotes.map((quote) => [quote.symbol, quote]));
    expect(bySymbol.get('AAPL.US')?.name).toBe('Apple Inc.');
    expect(bySymbol.get('600519.CN')?.name).toBe('贵州茅台');
  });
```

- [ ] **Step 2: Run the resolver tests (still green against current code)**

Run: `pnpm exec vitest run tests/edge/get-stock-quotes.test.ts`
Expected: PASS — with no `nameResolver` passed, the current code already falls back to the provider's name, so the new test passes before the refactor too. This locks in the behavior before deleting code.

- [ ] **Step 3: Remove the name-resolver machinery from `cache.ts`**

(a) Delete the `ChineseNameResolver` type block:

```ts
// Resolves Chinese display names for HK/CN symbols (Yahoo only has English).
// Returns canonicalSymbol -> name; symbols it can't name are simply omitted.
export type ChineseNameResolver = (
  symbols: EdgeNormalizedSymbol[]
) => Promise<Map<string, string>>;
```

(b) Delete the `nameResolver?` field (and its comment) from `ResolveStockQuotesInput`:

```ts
  // Optional: when set, HK/CN symbols missing a Chinese name get one from here
  // (fetched once and cached). Omitted in unit tests; wired to Tencent in prod.
  nameResolver?: ChineseNameResolver;
```

(c) Delete the entire Chinese-names lookup block (the `let chineseNames ...` through the closing brace of the `if (input.nameResolver) { ... }`):

```ts
  // Chinese names are static, so only ask the resolver for HK/CN symbols that
  // just refreshed and don't already have a Chinese name cached. Once a name is
  // stored, it is reused on every later refresh without another lookup.
  let chineseNames = new Map<string, string>();
  if (input.nameResolver) {
    const needNames = toFetch.filter(
      (symbol) =>
        (symbol.market === 'HK' || symbol.market === 'CN') &&
        freshBySymbol.has(symbol.canonicalSymbol) &&
        !hasChineseName(cachedBySymbol.get(symbol.canonicalSymbol)?.name)
    );
    if (needNames.length > 0) {
      try {
        chineseNames = await input.nameResolver(needNames);
      } catch {
        chineseNames = new Map();
      }
    }
  }
```

(d) In the `if (freshQuote)` branch, drop the `name:` override line so the spread keeps the provider's name. Change:

```ts
      const sanitized = sanitizeQuote({
        ...freshQuote,
        name: resolveDisplayName(symbol, freshQuote, cached, chineseNames),
        cacheExpiresAt: getCacheExpiresAt(input.now, input.ttlSeconds),
        lastRefreshAttemptAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      });
```

to:

```ts
      const sanitized = sanitizeQuote({
        ...freshQuote,
        cacheExpiresAt: getCacheExpiresAt(input.now, input.ttlSeconds),
        lastRefreshAttemptAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      });
```

(e) Delete the now-unused helpers `hasChineseName` and `resolveDisplayName`:

```ts
// True once a name contains CJK — our signal that a HK/CN row already holds a
// Chinese name and needs no further Tencent lookup.
function hasChineseName(name: string | undefined): boolean {
  return name !== undefined && /[㐀-鿿]/.test(name);
}

// HK/CN: prefer a freshly fetched Chinese name, else a Chinese name already
// cached, else Yahoo's English name. US/JP always keep Yahoo's name.
function resolveDisplayName(
  symbol: EdgeNormalizedSymbol,
  fresh: CachedStockQuote,
  cached: CachedStockQuote | null,
  chineseNames: Map<string, string>
): string | undefined {
  if (symbol.market === 'HK' || symbol.market === 'CN') {
    return (
      chineseNames.get(symbol.canonicalSymbol) ??
      (hasChineseName(cached?.name) ? cached?.name : fresh.name)
    );
  }
  return fresh.name;
}
```

(f) If `EdgeNormalizedSymbol` is now unused in `cache.ts`'s imports, remove it from the import to keep typecheck clean. Verify the import line at the top after editing; it should keep `CachedStockQuote`, `EdgeStockProvider`, and `parseEdgeCanonicalSymbol`.

- [ ] **Step 4: Run typecheck + full suite**

Run: `pnpm typecheck && pnpm exec vitest run`
Expected: PASS — `nameResolver`, `ChineseNameResolver`, `resolveDisplayName`, `hasChineseName` are gone and no test references them.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stocks/cache.ts tests/edge/get-stock-quotes.test.ts
git commit -m "refactor: take stock display name straight from the provider quote"
```

---

## Task 9: Update changelog and code map

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/CODE_MAP.md`

- [ ] **Step 1: Add a CHANGELOG entry**

Under `## [Unreleased]` → `### Changed` (create the `### Changed` subsection if absent), add:

```markdown
- Stock quotes for US, HK, and CN markets now come from Tencent (`qt.gtimg.cn`)
  instead of Yahoo Finance — no auth, fewer outages. Yahoo is kept only for
  Japan. US names stay in English.
```

- [ ] **Step 2: Update `docs/CODE_MAP.md`**

In the `stocks/` / `_shared/stocks/` region, make these changes:
- Add `tencent-provider.ts` — `[L1]` Tencent provider for US/HK/CN: `toTencentSymbol` + pure `parseTencentQuotes` (price/change%/name per market) + `createTencentProvider` fetch/GBK shell.
- Add `routing-provider.ts` — `[L1]` `splitByMarket` + `createRoutingProvider` (US/HK/CN → Tencent, JP → Yahoo; throws only if every leg fails).
- Update the `yahoo.ts` note to: Yahoo v7 batch quote provider, **now JP-only** (cookie/crumb auth).
- Remove the old `tencent.ts` (name-only resolver) entry.
- Update the `_shared/stocks/cache.ts` note: drop the mention of fetch-once Chinese-name resolution (`nameResolver`); names now come from each provider quote.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/CODE_MAP.md
git commit -m "docs: changelog + code map for Tencent stock source"
```

---

## Final Verification

- [ ] **Typecheck + unit tests:** `pnpm typecheck && pnpm exec vitest run` → all pass.
- [ ] **Deploy the Edge Functions** (they share `_shared/stocks`):
  `supabase functions deploy get-stock-quotes refresh-active-quotes`
- [ ] **Smoke run** (`pnpm dev`), exercising `/stock` and the header watchlist:
  - `AAPL.US` → English name (`Apple Inc.`) + price + change%.
  - `0700.HK` → `腾讯控股`, `600519.CN` → `贵州茅台` (Chinese names) + price + change%.
  - `7203.JP` → still prices via Yahoo (English name).
  - `/watch` a symbol, confirm the cron `refresh-active-quotes` broadcast updates the header.
  - Confirm a long US name (e.g. `TM.US`) truncates cleanly in the header table.
  - Note: free US quotes may lag ~15 min intraday (same as the old Yahoo feed).
- [ ] **Report honestly:** which checks passed by unit test vs smoke run, and anything not verified.

## Self-Review Notes (author)

- **Spec coverage:** Tencent US/HK/CN (Tasks 1–3), Yahoo JP routing (Tasks 4–6), English US names via field 46 (Task 2), name-resolver removal (Tasks 7–8), no migration (confirmed), docs (Task 9), verification incl. smoke (Final). All spec sections mapped.
- **Type consistency:** `toTencentSymbol`, `parseTencentQuotes`, `createTencentProvider`, `splitByMarket`, `SymbolSplit`, `createRoutingProvider` names are used identically across tasks and tests. `EdgeStockProvider`/`CachedStockQuote`/`EdgeNormalizedSymbol`/`EdgeMarket` are the existing types from `provider.ts`.
- **Ordering safety:** every intermediate commit keeps the typechecked scope (src + tests) green — `nameResolver` is removed from callers (Task 6) and the module deleted (Task 7) before the resolver param/types are dropped (Task 8).
