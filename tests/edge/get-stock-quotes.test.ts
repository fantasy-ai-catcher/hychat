import { describe, expect, it } from 'vitest';

import { resolveStockQuotes } from '../../supabase/functions/_shared/stocks/cache.js';
import type {
  CachedStockQuote,
  EdgeStockProvider
} from '../../supabase/functions/_shared/stocks/provider.js';

const now = new Date('2026-06-06T08:00:00.000Z');

function createCache(initial: CachedStockQuote[] = []) {
  const rows = new Map<string, CachedStockQuote>(
    initial.map((quote) => [quote.canonicalSymbol, quote])
  );
  const upserts: CachedStockQuote[] = [];

  return {
    upserts,
    store: {
      async get(symbol: string) {
        return rows.get(symbol) ?? null;
      },
      async upsert(quote: CachedStockQuote) {
        rows.set(quote.canonicalSymbol, quote);
        upserts.push(quote);
      }
    }
  };
}

describe('resolveStockQuotes', () => {
  it('rejects empty symbol requests', async () => {
    const cache = createCache();
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote() {
        throw new Error('not expected');
      }
    };

    await expect(
      resolveStockQuotes({
        symbols: [],
        force: false,
        cache: cache.store,
        provider,
        now,
        ttlSeconds: 60
      })
    ).rejects.toThrow('At least one symbol is required');
  });

  it('returns cache hits without calling the provider', async () => {
    const cache = createCache([
      {
        canonicalSymbol: 'AAPL.US',
        market: 'US',
        providerSymbol: 'AAPL',
        provider: 'twelve_data',
        status: 'ok',
        price: 123,
        changePercent: 1,
        cacheExpiresAt: '2026-06-06T08:00:30.000Z',
        updatedAt: '2026-06-06T07:59:30.000Z'
      }
    ]);
    let providerCalls = 0;
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote() {
        providerCalls += 1;
        throw new Error('not expected');
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['AAPL.US'],
      force: false,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60
    });

    expect(providerCalls).toBe(0);
    expect(result).toEqual({
      quotes: [
        expect.objectContaining({
          symbol: 'AAPL.US',
          price: 123,
          changePercent: 1,
          cacheStatus: 'hit'
        })
      ],
      failed: []
    });
  });

  it('refreshes expired cache rows and upserts sanitized provider quotes', async () => {
    const cache = createCache([
      {
        canonicalSymbol: '0700.HK',
        market: 'HK',
        providerSymbol: '0700',
        provider: 'twelve_data',
        status: 'ok',
        price: 400,
        changePercent: 0.1,
        cacheExpiresAt: '2026-06-06T07:59:59.000Z',
        updatedAt: '2026-06-06T07:59:00.000Z'
      }
    ]);
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote(symbol) {
        return {
          canonicalSymbol: symbol.canonicalSymbol,
          market: symbol.market,
          providerSymbol: symbol.providerSymbol,
          providerExchange: symbol.providerExchange,
          micCode: symbol.micCode,
          provider: 'twelve_data',
          status: 'ok',
          name: 'Tencent Holdings Limited',
          currency: 'HKD',
          price: 456.7,
          changePercent: -0.5,
          cacheExpiresAt: 'ignored',
          updatedAt: 'ignored',
          providerPayload: { secret: 'drop-me', useful: 'keep' }
        };
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['0700.HK'],
      force: false,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60
    });

    expect(result.quotes[0]).toEqual(
      expect.objectContaining({
        symbol: '0700.HK',
        price: 456.7,
        cacheStatus: 'refreshed'
      })
    );
    expect(cache.upserts[0]).toEqual(
      expect.objectContaining({
        canonicalSymbol: '0700.HK',
        cacheExpiresAt: '2026-06-06T08:01:00.000Z',
        providerPayload: { useful: 'keep' }
      })
    );
  });

  it('returns stale fallback when provider refresh fails', async () => {
    const cache = createCache([
      {
        canonicalSymbol: '600519.CN',
        market: 'CN',
        providerSymbol: '600519',
        provider: 'twelve_data',
        status: 'ok',
        price: 1500,
        changePercent: 0.2,
        cacheExpiresAt: '2026-06-06T07:59:59.000Z',
        updatedAt: '2026-06-06T07:59:00.000Z'
      }
    ]);
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote() {
        throw new Error('rate_limited');
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['600519.CN'],
      force: false,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60
    });

    expect(result).toEqual({
      quotes: [
        expect.objectContaining({
          symbol: '600519.CN',
          price: 1500,
          cacheStatus: 'stale'
        })
      ],
      failed: [{ symbol: '600519.CN', reason: 'rate_limited' }]
    });
  });

  it('records the failed refresh attempt so retries can back off', async () => {
    const cache = createCache([
      {
        canonicalSymbol: '600519.CN',
        market: 'CN',
        providerSymbol: '600519',
        provider: 'twelve_data',
        status: 'ok',
        price: 1500,
        changePercent: 0.2,
        cacheExpiresAt: '2026-06-06T07:59:59.000Z',
        updatedAt: '2026-06-06T07:59:00.000Z'
      }
    ]);
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote() {
        throw new Error('rate_limited');
      }
    };

    await resolveStockQuotes({
      symbols: ['600519.CN'],
      force: false,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60
    });

    expect(cache.upserts[0]).toEqual(
      expect.objectContaining({
        canonicalSymbol: '600519.CN',
        status: 'stale',
        lastRefreshAttemptAt: now.toISOString()
      })
    );
  });

  it('serves the stale row without a provider call while a recent attempt is cooling down', async () => {
    const cache = createCache([
      {
        canonicalSymbol: '600519.CN',
        market: 'CN',
        providerSymbol: '600519',
        provider: 'twelve_data',
        status: 'stale',
        price: 1500,
        changePercent: 0.2,
        cacheExpiresAt: '2026-06-06T07:59:59.000Z',
        lastRefreshAttemptAt: '2026-06-06T07:59:55.000Z',
        updatedAt: '2026-06-06T07:59:00.000Z'
      }
    ]);
    let providerCalls = 0;
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote() {
        providerCalls += 1;
        throw new Error('not expected');
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['600519.CN'],
      force: false,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60,
      failureRetrySeconds: 15
    });

    expect(providerCalls).toBe(0);
    expect(result.quotes[0]).toEqual(
      expect.objectContaining({ symbol: '600519.CN', cacheStatus: 'stale' })
    );
    expect(result.failed).toEqual([]);
  });

  it('throttles force refreshes against a fresh ok cache row', async () => {
    const cache = createCache([
      {
        canonicalSymbol: 'AAPL.US',
        market: 'US',
        providerSymbol: 'AAPL',
        provider: 'twelve_data',
        status: 'ok',
        price: 123,
        changePercent: 1,
        cacheExpiresAt: '2026-06-06T08:00:30.000Z',
        lastRefreshAttemptAt: '2026-06-06T07:59:50.000Z',
        updatedAt: '2026-06-06T07:59:50.000Z'
      }
    ]);
    let providerCalls = 0;
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote() {
        providerCalls += 1;
        throw new Error('not expected');
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['AAPL.US'],
      force: true,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60,
      forceMinIntervalSeconds: 30
    });

    expect(providerCalls).toBe(0);
    expect(result.quotes[0]).toEqual(
      expect.objectContaining({ symbol: 'AAPL.US', cacheStatus: 'hit' })
    );
  });

  it('allows force refreshes once the throttle window has passed', async () => {
    const cache = createCache([
      {
        canonicalSymbol: 'AAPL.US',
        market: 'US',
        providerSymbol: 'AAPL',
        provider: 'twelve_data',
        status: 'ok',
        price: 123,
        changePercent: 1,
        cacheExpiresAt: '2026-06-06T08:00:30.000Z',
        lastRefreshAttemptAt: '2026-06-06T07:59:00.000Z',
        updatedAt: '2026-06-06T07:59:00.000Z'
      }
    ]);
    const provider: EdgeStockProvider = {
      id: 'test',
      async getQuote(symbol) {
        return {
          canonicalSymbol: symbol.canonicalSymbol,
          market: symbol.market,
          providerSymbol: symbol.providerSymbol,
          provider: 'twelve_data',
          status: 'ok',
          price: 130,
          changePercent: 2,
          cacheExpiresAt: 'ignored',
          updatedAt: 'ignored'
        };
      }
    };

    const result = await resolveStockQuotes({
      symbols: ['AAPL.US'],
      force: true,
      cache: cache.store,
      provider,
      now,
      ttlSeconds: 60,
      forceMinIntervalSeconds: 30
    });

    expect(result.quotes[0]).toEqual(
      expect.objectContaining({ symbol: 'AAPL.US', price: 130, cacheStatus: 'refreshed' })
    );
  });
});
