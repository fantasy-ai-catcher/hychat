import { describe, expect, it } from 'vitest';

import {
  createSinaHkProvider,
  parseSinaHkRealtime,
  toSinaHkSymbol
} from '../../supabase/functions/_shared/stocks/sina-hk.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';
import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from '../../supabase/functions/_shared/stocks/provider.js';

describe('toSinaHkSymbol', () => {
  it('maps HK symbols to Sina rt_hk tickers (5-digit) and ignores other markets', () => {
    expect(toSinaHkSymbol(parseEdgeCanonicalSymbol('7709.HK'))).toBe('rt_hk07709');
    expect(toSinaHkSymbol(parseEdgeCanonicalSymbol('0700.HK'))).toBe('rt_hk00700');
    expect(toSinaHkSymbol(parseEdgeCanonicalSymbol('AAPL.US'))).toBeNull();
    expect(toSinaHkSymbol(parseEdgeCanonicalSymbol('600519.CN'))).toBeNull();
  });
});

describe('parseSinaHkRealtime', () => {
  // rt_hk line: [1]name [3]prevClose [6]price [7]change [8]changePercent
  function line(ticker: string, fields: Record<number, string>) {
    const arr = Array(12).fill('0');
    for (const [i, v] of Object.entries(fields)) arr[Number(i)] = v;
    return `var hq_str_${ticker}="${arr.join(',')}";`;
  }

  it('extracts realtime price/change/percent keyed by canonical symbol', () => {
    const text = line('rt_hk07709', { 1: '名', 3: '143.8', 6: '132.15', 7: '-11.65', 8: '-8.10' });
    const result = parseSinaHkRealtime(text, new Map([['rt_hk07709', '7709.HK']]));
    expect(result.get('7709.HK')).toEqual({ price: 132.15, change: -11.65, changePercent: -8.1 });
  });

  it('skips rows with no price and unknown tickers', () => {
    const text =
      line('rt_hk07709', { 6: '0' }) + '\n' + line('rt_hk00001', { 6: '5' });
    const result = parseSinaHkRealtime(text, new Map([['rt_hk07709', '7709.HK']]));
    expect(result.size).toBe(0);
  });
});

describe('createSinaHkProvider', () => {
  function baseProvider(quotes: CachedStockQuote[]): EdgeStockProvider {
    return { id: 'tencent', async getQuotes() { return quotes; } };
  }
  function quote(canonical: string, market: 'HK' | 'US', name: string, price: number): CachedStockQuote {
    return {
      canonicalSymbol: canonical as CachedStockQuote['canonicalSymbol'],
      market,
      providerSymbol: canonical.split('.')[0],
      provider: 'tencent',
      status: 'ok',
      name,
      price,
      change: 0,
      changePercent: 0,
      cacheExpiresAt: 'ignored',
      updatedAt: 'ignored'
    };
  }

  function sinaLine(ticker: string, fields: Record<number, string>) {
    const arr = Array(12).fill('0');
    for (const [i, v] of Object.entries(fields)) arr[Number(i)] = v;
    return `var hq_str_${ticker}="${arr.join(',')}";`;
  }

  const syms = ['7709.HK', 'AAPL.US'].map(parseEdgeCanonicalSymbol);

  it('overlays HK realtime price/change but keeps the base (Tencent) name; leaves non-HK alone', async () => {
    const base = baseProvider([
      quote('7709.HK', 'HK', 'XL二南方海力士', 137.7), // Tencent delayed price + name
      quote('AAPL.US', 'US', 'Apple Inc.', 297.01)
    ]);
    let calledUrl = '';
    const fetchImpl = (async (url: unknown) => {
      calledUrl = String(url);
      return new Response(sinaLine('rt_hk07709', { 6: '132.15', 7: '-11.65', 8: '-8.10' }), {
        status: 200
      });
    }) as unknown as typeof fetch;

    const provider = createSinaHkProvider(base, { fetchImpl });
    const quotes = await provider.getQuotes(syms);
    const by = new Map(quotes.map((q) => [q.canonicalSymbol, q]));

    expect(calledUrl).toContain('rt_hk07709');
    expect(calledUrl).not.toContain('AAPL');
    expect(by.get('7709.HK')).toMatchObject({
      price: 132.15,
      change: -11.65,
      changePercent: -8.1,
      name: 'XL二南方海力士' // kept from Tencent
    });
    expect(by.get('AAPL.US')).toMatchObject({ price: 297.01, name: 'Apple Inc.' });
  });

  it('returns base quotes unchanged when Sina fails (best-effort overlay)', async () => {
    const base = baseProvider([quote('7709.HK', 'HK', 'name', 137.7)]);
    const fetchImpl = (async () => {
      throw new Error('sina down');
    }) as unknown as typeof fetch;
    const provider = createSinaHkProvider(base, { fetchImpl });
    const quotes = await provider.getQuotes([parseEdgeCanonicalSymbol('7709.HK')]);
    expect(quotes[0].price).toBe(137.7);
  });

  it('does not fetch when there are no HK symbols', async () => {
    const base = baseProvider([quote('AAPL.US', 'US', 'Apple', 297)]);
    const fetchImpl = (async () => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;
    const provider = createSinaHkProvider(base, { fetchImpl });
    const quotes = await provider.getQuotes([parseEdgeCanonicalSymbol('AAPL.US')]);
    expect(quotes[0].price).toBe(297);
  });
});
