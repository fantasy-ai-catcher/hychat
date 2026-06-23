import { describe, expect, it } from 'vitest';

import {
  createRoutingProvider,
  splitByMarket
} from '../../supabase/functions/_shared/stocks/routing-provider.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';
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
