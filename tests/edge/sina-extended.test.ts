import { describe, expect, it } from 'vitest';

import {
  createExtendedHoursProvider,
  parseSinaExtended,
  toSinaUsSymbol,
  usMarketSession
} from '../../supabase/functions/_shared/stocks/sina-extended.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';
import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from '../../supabase/functions/_shared/stocks/provider.js';

describe('usMarketSession', () => {
  // 2026-06-23 is a Tuesday; June -> EDT (UTC-4).
  it('classifies the US trading day by Eastern time', () => {
    expect(usMarketSession(new Date('2026-06-23T12:30:00Z'))).toBe('pre'); // 08:30 ET
    expect(usMarketSession(new Date('2026-06-23T14:00:00Z'))).toBe('regular'); // 10:00 ET
    expect(usMarketSession(new Date('2026-06-23T21:00:00Z'))).toBe('post'); // 17:00 ET
    expect(usMarketSession(new Date('2026-06-23T02:00:00Z'))).toBe('closed'); // 22:00 ET Mon
  });

  it('uses 09:30 and 16:00 as the regular-session boundaries', () => {
    expect(usMarketSession(new Date('2026-06-23T13:29:00Z'))).toBe('pre'); // 09:29 ET
    expect(usMarketSession(new Date('2026-06-23T13:30:00Z'))).toBe('regular'); // 09:30 ET
    expect(usMarketSession(new Date('2026-06-23T20:00:00Z'))).toBe('post'); // 16:00 ET
  });

  it('treats weekends as closed', () => {
    expect(usMarketSession(new Date('2026-06-20T13:00:00Z'))).toBe('closed'); // Sat 09:00 ET
  });
});

describe('toSinaUsSymbol', () => {
  it('maps US tickers to Sina gb_ symbols and ignores other markets', () => {
    expect(toSinaUsSymbol(parseEdgeCanonicalSymbol('AAPL.US'))).toBe('gb_aapl');
    expect(toSinaUsSymbol(parseEdgeCanonicalSymbol('0700.HK'))).toBeNull();
    expect(toSinaUsSymbol(parseEdgeCanonicalSymbol('600519.CN'))).toBeNull();
    expect(toSinaUsSymbol(parseEdgeCanonicalSymbol('7203.JP'))).toBeNull();
  });
});

describe('parseSinaExtended', () => {
  // Sina gb_ line: field[21]=ext price, [22]=ext change%, [23]=ext change amount.
  function line(ticker: string, fields: Record<number, string>) {
    const arr = Array(25).fill('0');
    for (const [i, v] of Object.entries(fields)) arr[Number(i)] = v;
    return `var hq_str_${ticker}="${arr.join(',')}";`;
  }

  it('extracts extended price/change/percent keyed by canonical symbol', () => {
    const text =
      line('gb_aapl', { 1: '297.01', 21: '294.4930', 22: '-0.85', 23: '-2.52' }) +
      '\n' +
      line('gb_tsla', { 1: '405.05', 21: '394.1050', 22: '-2.70', 23: '-10.95' });
    const map = new Map([
      ['gb_aapl', 'AAPL.US'],
      ['gb_tsla', 'TSLA.US']
    ]);

    const result = parseSinaExtended(text, map);

    expect(result.get('AAPL.US')).toEqual({ price: 294.493, change: -2.52, changePercent: -0.85 });
    expect(result.get('TSLA.US')).toEqual({ price: 394.105, change: -10.95, changePercent: -2.7 });
  });

  it('skips rows with no extended price and unknown tickers', () => {
    const text =
      line('gb_aapl', { 21: '0' }) + '\n' + line('gb_nope', { 21: '10' });
    const result = parseSinaExtended(text, new Map([['gb_aapl', 'AAPL.US']]));
    expect(result.size).toBe(0);
  });
});

describe('createExtendedHoursProvider', () => {
  function sinaLine(ticker: string, fields: Record<number, string>) {
    const arr = Array(25).fill('0');
    for (const [i, v] of Object.entries(fields)) arr[Number(i)] = v;
    return `var hq_str_${ticker}="${arr.join(',')}";`;
  }

  function baseQuote(symbol: EdgeNormalizedSymbol, price: number): CachedStockQuote {
    return {
      canonicalSymbol: symbol.canonicalSymbol,
      market: symbol.market,
      providerSymbol: symbol.providerSymbol,
      provider: 'tencent',
      status: 'ok',
      name: symbol.canonicalSymbol,
      price,
      change: 0,
      changePercent: 0,
      cacheExpiresAt: 'ignored',
      updatedAt: 'ignored'
    };
  }

  function fakeBase(prices: Record<string, number>): EdgeStockProvider {
    return {
      id: 'tencent',
      async getQuotes(symbols) {
        return symbols.map((s) => baseQuote(s, prices[s.canonicalSymbol] ?? 0));
      }
    };
  }

  const syms = ['AAPL.US', '0700.HK'].map(parseEdgeCanonicalSymbol);

  it('overwrites US price/change/percent with Sina extended data during pre/post', async () => {
    let calls = 0;
    const fetchImpl = (async (url: unknown) => {
      calls += 1;
      expect(String(url)).toContain('hq.sinajs.cn/list=gb_aapl');
      return new Response(sinaLine('gb_aapl', { 21: '294.49', 22: '-0.85', 23: '-2.52' }), {
        status: 200
      });
    }) as unknown as typeof fetch;

    const provider = createExtendedHoursProvider(fakeBase({ 'AAPL.US': 297.01, '0700.HK': 414.8 }), {
      fetchImpl,
      now: () => new Date('2026-06-23T12:30:00Z') // pre-market
    });

    const quotes = await provider.getQuotes(syms);
    const by = new Map(quotes.map((q) => [q.canonicalSymbol, q]));

    expect(calls).toBe(1);
    expect(by.get('AAPL.US')).toMatchObject({ price: 294.49, change: -2.52, changePercent: -0.85 });
    // non-US is never touched
    expect(by.get('0700.HK')).toMatchObject({ price: 414.8 });
  });

  it('does not fetch or modify quotes during the regular session', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createExtendedHoursProvider(fakeBase({ 'AAPL.US': 297.01, '0700.HK': 414.8 }), {
      fetchImpl,
      now: () => new Date('2026-06-23T14:00:00Z') // regular session
    });

    const quotes = await provider.getQuotes(syms);
    expect(calls).toBe(0);
    expect(quotes.find((q) => q.canonicalSymbol === 'AAPL.US')?.price).toBe(297.01);
  });

  it('returns base quotes unchanged when Sina fails (best-effort overlay)', async () => {
    const fetchImpl = (async () => {
      throw new Error('sina down');
    }) as unknown as typeof fetch;

    const provider = createExtendedHoursProvider(fakeBase({ 'AAPL.US': 297.01 }), {
      fetchImpl,
      now: () => new Date('2026-06-23T12:30:00Z') // pre-market
    });

    const quotes = await provider.getQuotes([parseEdgeCanonicalSymbol('AAPL.US')]);
    expect(quotes[0].price).toBe(297.01);
  });
});
